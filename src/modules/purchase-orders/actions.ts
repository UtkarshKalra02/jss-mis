"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { JOB_CLOSE_ROLES } from "@/auth/roles";
import { db } from "@/db";
import {
  auditedAppend,
  auditedInsert,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
  type Tx,
} from "@/db/audit";
import { recomputeForPoItem, withStatusWrite } from "@/db/po-status";
import { poItem, purchaseOrder, stageEvent } from "@/db/schema";
import { actionError } from "@/lib/action-error";
import { startOfDayIST, wallClockIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import {
  countLiveItems,
  dispatchedQtyFor,
  findDuplicatePoNo,
  getPoItem,
  getPurchaseOrder,
  listPoItems,
  manualCloseEligibility,
} from "./queries";
import { removalBlockers } from "./removal";
import {
  closeReasonSchema,
  createPoSchema,
  poHeaderSchema,
  poItemCreateSchema,
  poItemSchema,
} from "./validation";

/**
 * `warning` is not an error. It carries the duplicate-PO-number question
 * (decision F7), which the form re-submits past with confirmDuplicate. A
 * blocking constraint would reject real historical data; a question asked once
 * catches the typo without refusing the truth.
 */
export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  warning?: string;
  redirectTo?: string;
};

const ok = (extra: Partial<FormState> = {}): FormState => ({ ok: true, error: null, ...extra });
const fail = (error: string): FormState => ({ ok: false, error });
const warn = (warning: string): FormState => ({ ok: false, error: null, warning });

/**
 * Spec 6.3: PO capture belongs to ORDER_DESK (and ADMIN). Since P5 the
 * PLANNER may capture too, on "create": the one action that cannot rewrite
 * anybody else's work. Everything that touches an existing PO stays "write".
 */
async function requirePoWriter(access: "create" | "write" = "write"): Promise<Actor> {
  const user = await requireAccess("purchase_order", access);
  return { id: user.id, role: user.role };
}

const orNull = (v: string | undefined) => v ?? null;
const idOrNull = (v: string | undefined) => (v && v.length > 0 ? v : null);

/* -------------------------------------------------------------------------- */
/* The one place a PO item is born                                             */
/* -------------------------------------------------------------------------- */

/**
 * Creates a po_item and its opening stage event, together.
 *
 * Spec 6.3: "On save: creates po_item rows and a PO_RECEIVED stage event for
 * each." Both happen here so there is no path that produces an item with no
 * stage history — an item whose current_stage is null looks identical to one
 * somebody forgot to update, and the Item Tracker cannot tell you which.
 *
 * The event is dated by the PO, not by the clock (the same rule as F3 for
 * dispatch). A PO entered three weeks late is three weeks old, and pretending
 * it arrived this afternoon would make every ageing figure derived from it
 * wrong in the flattering direction.
 */
async function insertPoItem(
  actor: Actor,
  tx: Tx,
  args: {
    purchaseOrderId: string;
    poDate: string;
    values: ReturnType<typeof poItemCreateSchema.parse>;
  },
) {
  const { purchaseOrderId, poDate, values: v } = args;

  const itemCode = await allocateNumber(tx, "ITM", poDate);

  const row = await auditedInsert(
    actor,
    poItem,
    {
      itemCode,
      purchaseOrderId,
      designId: idOrNull(v.designId),
      itemName: v.itemName,
      orderedQty: v.orderedQty,
      rate: orNull(v.rate),
      committedDate: v.committedDate,
      committedDateBasis: "Manual",
      jobType: v.jobType,
      priority: v.priority,
      remarks: orNull(v.remarks),

      /*
       * SOP Rule 1 (W). All three or none — po_item_confirmation_all_or_none
       * says so in the database too. wallClockIST because the browser posts
       * "2026-11-17T10:05" with no zone and the server runs on UTC; see the
       * helper for what that costs if you forget.
       */
      confirmationSource: v.confirmationSource,
      confirmedBy: v.confirmedBy,
      confirmedAt: wallClockIST(v.confirmedAt),
    },
    tx,
  );

  await auditedAppend(
    actor,
    stageEvent,
    {
      poItemId: row.id,
      stageCode: "PO_RECEIVED",
      eventAt: startOfDayIST(poDate),
    },
    tx,
  );

  return row;
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Items post as parallel arrays, one entry per field per row.
 *
 * Every row renders every field — including the empty ones — so the arrays are
 * the same length and index i is row i throughout. That is the property the
 * whole scheme rests on, which is why the form must never conditionally omit an
 * input.
 */
const ITEM_FIELDS = [
  "itemName",
  "orderedQty",
  "rate",
  "committedDate",
  "jobType",
  "priority",
  "designId",
  "remarks",
] as const;

function parseItems(formData: FormData): Record<string, string>[] {
  const columns = Object.fromEntries(
    ITEM_FIELDS.map((field) => [field, formData.getAll(field).map(String)]),
  ) as Record<(typeof ITEM_FIELDS)[number], string[]>;

  /*
   * The confirmation (W) is posted ONCE, not per row, and copied onto every
   * item. A purchase order arrives as a single confirmation: one source, one
   * person, one time. Rendering it per row would invite three different
   * answers to the same question, and the parallel-array scheme above would
   * then have to keep them straight for no gain.
   *
   * It is still stored per item, because an item added to this order next
   * week was confirmed at a different moment and must be able to say so.
   */
  const confirmation = {
    confirmationSource: String(formData.get("confirmationSource") ?? ""),
    confirmedBy: String(formData.get("confirmedBy") ?? ""),
    confirmedAt: String(formData.get("confirmedAt") ?? ""),
  };

  return columns.itemName.map((_, i) => ({
    ...Object.fromEntries(ITEM_FIELDS.map((field) => [field, columns[field][i] ?? ""])),
    ...confirmation,
  }));
}

export async function createPurchaseOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter("create");

    const parsed = createPoSchema.safeParse({
      clientId: formData.get("clientId"),
      poNo: formData.get("poNo"),
      poDate: formData.get("poDate"),
      fileUrl: formData.get("fileUrl"),
      isJobWork: formData.get("isJobWork") ?? undefined,
      notes: formData.get("notes"),
      items: parseItems(formData),
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      // Name the row, or "Quantity must be more than zero" on a ten-item PO
      // is a hunt rather than a correction.
      const row = issue.path[0] === "items" ? ` (item ${Number(issue.path[1]) + 1})` : "";
      return fail(`${issue.message}${row}`);
    }

    const v = parsed.data;

    /*
     * N1: items added before their PO exists. The form posts no client PO
     * number and no scan, and the order goes in with po_no blank — which is
     * all "PO awaited" is. Same rows, same validation, same stage event; the
     * only thing the flag changes is what the confirmation says.
     */
    const withoutPo = formData.get("withoutPo") === "true";

    if (v.poNo && formData.get("confirmDuplicate") !== "true") {
      const duplicate = await findDuplicatePoNo(v.clientId, v.poNo);
      if (duplicate) {
        return warn(
          `This client already has a PO numbered "${v.poNo}" — ${duplicate.internalNo}, dated ${duplicate.poDate}. Save anyway if it is genuinely a second one.`,
        );
      }
    }

    const created = await db.transaction(async (tx) => {
      const internalNo = await allocateNumber(tx, "PO", v.poDate);

      const po = await auditedInsert(
        actor,
        purchaseOrder,
        {
          internalNo,
          poNo: orNull(v.poNo),
          clientId: v.clientId,
          poDate: v.poDate,
          fileUrl: orNull(v.fileUrl),
          // A native checkbox posts "on" or nothing; absent is false, never
          // null — the column is NOT NULL (section Z).
          isJobWork: v.isJobWork === "on",
          notes: orNull(v.notes),
        },
        tx,
      );

      const createdItems: string[] = [];

      for (const item of v.items) {
        const row = await insertPoItem(actor, tx, {
          purchaseOrderId: po.id,
          poDate: v.poDate,
          values: item,
        });
        createdItems.push(row.id);
      }

      return { po, createdItems };
    });

    revalidatePath("/purchase-orders");
    revalidatePath("/items");
    const count = `${v.items.length} item${v.items.length === 1 ? "" : "s"}`;

    /*
     * COMING FROM THE JOB CARD, GO BACK TO IT (U1).
     *
     * Raising a card for work whose PO has not arrived used to be two screens
     * and a search: add the item, then go to Job Cards, then find what you
     * just typed. With `returnTo=job-card` the single item lands straight back
     * on the card form, selected.
     *
     * Only for a single item, deliberately. The card form takes one item at a
     * time (several only as a gang, chosen by ticking), so sending somebody
     * back with three new items would have to pick one for them, and the one
     * it picked would be wrong a third of the time. More than one goes to the
     * order, where all of them are visible.
     */
    const backToCard =
      formData.get("returnTo") === "job-card" && created.createdItems.length === 1;

    return ok({
      message: withoutPo
        ? `${count} added under ${created.po.internalNo}, PO awaited. Record the client's PO number here when it arrives.`
        : `${created.po.internalNo} captured with ${count}.`,
      redirectTo: backToCard
        ? `/job-cards/new?item=${created.createdItems[0]}`
        : `/purchase-orders/${created.po.id}`,
    });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the purchase order."));
  }
}

/* -------------------------------------------------------------------------- */
/* Move an item onto another order (N1)                                        */
/* -------------------------------------------------------------------------- */

/**
 * The client's PO arrived, and it covers an item that was added before it
 * existed — or several, added on different days under different "PO awaited"
 * orders. The item moves onto the PO; nothing else does.
 *
 * Nothing else NEEDS to. Stage events, job cards, dispatch lines and plan
 * entries all reference the item's id, so its history follows it. That is
 * also why a move is permitted after dispatch: the case this exists for is
 * precisely a PO that turns up after the goods have gone.
 *
 * Same client only, and the database says so too (migration 0038): the
 * dispatch trigger checked client agreement when each line was written, and
 * a cross-client move would silently undo that. The check here is so the
 * refusal is a sentence rather than an exception.
 *
 * If the order it left is now empty and was itself PO awaited, it is removed
 * (K21's soft delete) — an empty placeholder is a row nobody will ever look
 * at again. An emptied REAL order is left alone and named in the message: a
 * PO with a number on it is a document, and somebody should decide.
 */
export async function moveItemToPurchaseOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const id = String(formData.get("id") ?? "");
    const targetId = String(formData.get("targetPurchaseOrderId") ?? "");

    const existing = await getPoItem(id);
    if (!existing) return fail("That item no longer exists.");
    if (!targetId) return fail("Choose the purchase order to move this item onto.");
    if (targetId === existing.purchaseOrderId) return fail("The item is already on that order.");

    const [source, target] = await Promise.all([
      getPurchaseOrder(existing.purchaseOrderId),
      getPurchaseOrder(targetId),
    ]);
    if (!source) return fail("The order this item is on no longer exists.");
    if (!target) return fail("That purchase order no longer exists.");
    if (target.clientId !== source.clientId) {
      return fail(
        `${target.internalNo} belongs to ${target.clientCode}, not ${source.clientCode}. An item cannot change client.`,
      );
    }
    if (target.status === "Cancelled") {
      return fail(`${target.internalNo} is cancelled. Reinstate it before moving items onto it.`);
    }

    const sourceRemoved = await db.transaction(async (tx) => {
      await auditedUpdate(actor, poItem, id, { purchaseOrderId: targetId }, tx);

      const left = await countLiveItems(source.id, tx);
      if (left === 0 && source.poAwaited) {
        await auditedSoftDelete(actor, purchaseOrder, source.id, tx);
        return true;
      }
      return false;
    });

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${source.id}`);
    revalidatePath(`/purchase-orders/${targetId}`);
    revalidatePath(`/items/${id}`);
    revalidatePath("/items");

    return ok({
      message: sourceRemoved
        ? `${existing.itemCode} moved to ${target.internalNo}. ${source.internalNo} had nothing left on it and was removed.`
        : `${existing.itemCode} moved to ${target.internalNo}.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not move the item."));
  }
}

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

export async function updatePoHeaderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getPurchaseOrder(id);
    if (!existing) return fail("That purchase order no longer exists.");

    const parsed = poHeaderSchema.safeParse({
      clientId: formData.get("clientId"),
      poNo: formData.get("poNo"),
      poDate: formData.get("poDate"),
      fileUrl: formData.get("fileUrl"),
      isJobWork: formData.get("isJobWork") ?? undefined,
      notes: formData.get("notes"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    if (v.poNo && formData.get("confirmDuplicate") !== "true") {
      const duplicate = await findDuplicatePoNo(v.clientId, v.poNo, id);
      if (duplicate) {
        return warn(
          `This client already has a PO numbered "${v.poNo}" — ${duplicate.internalNo}, dated ${duplicate.poDate}. Save anyway if it is genuinely a second one.`,
        );
      }
    }

    await auditedUpdate(actor, purchaseOrder, id, {
      clientId: v.clientId,
      poNo: orNull(v.poNo),
      poDate: v.poDate,
      fileUrl: orNull(v.fileUrl),
      isJobWork: v.isJobWork === "on",
      notes: orNull(v.notes),
    });

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    return ok({ message: "Saved." });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the changes."));
  }
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

function itemFields(formData: FormData) {
  return {
    itemName: formData.get("itemName"),
    orderedQty: formData.get("orderedQty"),
    rate: formData.get("rate"),
    committedDate: formData.get("committedDate"),
    jobType: formData.get("jobType"),
    priority: formData.get("priority"),
    designId: formData.get("designId"),
    remarks: formData.get("remarks"),
  };
}

/**
 * ADDING an item asks how the order was confirmed (W); EDITING one does not.
 *
 * Two functions rather than a flag because the difference is not cosmetic:
 * the confirmation is a fact about the moment the job was opened, and an edit
 * that could restate it would let a correction to a quantity quietly reset
 * the clock SOP Rule 1 is measured by. updatePoItemAction writes neither
 * column, and now cannot be asked to.
 */
function parseNewItem(formData: FormData) {
  return poItemCreateSchema.safeParse({
    ...itemFields(formData),
    confirmationSource: formData.get("confirmationSource"),
    confirmedBy: formData.get("confirmedBy"),
    confirmedAt: formData.get("confirmedAt"),
  });
}

function parseExistingItem(formData: FormData) {
  return poItemSchema.safeParse(itemFields(formData));
}

export async function addPoItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");

    const po = await getPurchaseOrder(purchaseOrderId);
    if (!po) return fail("That purchase order no longer exists.");
    if (po.status === "Cancelled") {
      return fail("This PO is cancelled. Reinstate it before adding items.");
    }

    const parsed = parseNewItem(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const created = await db.transaction((tx) =>
      insertPoItem(actor, tx, {
        purchaseOrderId,
        poDate: po.poDate,
        values: parsed.data,
      }),
    );

    revalidatePath(`/purchase-orders/${purchaseOrderId}`);
    return ok({ message: `${created.itemCode} added.` });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not add the item."));
  }
}

export async function updatePoItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getPoItem(id);
    if (!existing) return fail("That item no longer exists.");

    const parsed = parseExistingItem(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    // The database refuses this too (F13). Asking first turns a trigger's
    // exception into a sentence, and names the number that is in the way.
    if (v.orderedQty < existing.orderedQty) {
      const dispatched = await dispatchedQtyFor(id);
      if (v.orderedQty < dispatched) {
        return fail(
          `${dispatched} have already been dispatched against this item, so the order cannot drop to ${v.orderedQty}. Correct or cancel the challans first.`,
        );
      }
    }

    await auditedUpdate(actor, poItem, id, {
      designId: idOrNull(v.designId),
      itemName: v.itemName,
      orderedQty: v.orderedQty,
      rate: orNull(v.rate),
      committedDate: v.committedDate,
      jobType: v.jobType,
      priority: v.priority,
      remarks: orNull(v.remarks),
    });

    revalidatePath(`/purchase-orders/${existing.purchaseOrderId}`);
    revalidatePath(`/items/${id}`);
    return ok({ message: "Saved." });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the item."));
  }
}

/**
 * Removing an item is for one entered by mistake.
 *
 * Anything that has been dispatched has real history attached and is cancelled
 * rather than removed — soft-deleting it would leave live dispatch_line rows
 * pointing at a row nothing displays, and the challan would still say it went
 * out.
 */
export async function removePoItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getPoItem(id);
    if (!existing) return fail("That item no longer exists.");

    const dispatched = await dispatchedQtyFor(id);
    if (dispatched > 0) {
      return fail(
        `${existing.itemCode} has ${dispatched} dispatched against it and cannot be removed. Cancel it instead — that keeps the delivery history intact.`,
      );
    }

    await auditedSoftDelete(actor, poItem, id);

    revalidatePath(`/purchase-orders/${existing.purchaseOrderId}`);
    /*
     * Back to the order, by SERVER redirect (J13). The item's own screen reads
     * a row that no longer exists, and returning a destination for the client
     * to push to loses a race it cannot win — the route re-renders and calls
     * notFound() before the effect commits.
     */
    redirect(
      `/purchase-orders/${existing.purchaseOrderId}?removed=${encodeURIComponent(
        `${existing.itemCode} removed.`,
      )}`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not remove the item."));
  }
}

/**
 * Removing a whole purchase order is for one entered by mistake — the same
 * rule as removing an item, applied to all of them at once (K21).
 *
 * Refused if anything on it has been dispatched, for the reason the item
 * action gives: the challans would still say it went out. A PO that was real
 * and then dropped is cancelled, not removed. Everything happens in one
 * transaction — every item and then the header — so a refusal or a failure
 * part-way leaves the order exactly as it was rather than half gone.
 */
export async function removePurchaseOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getPurchaseOrder(id);
    if (!existing) return fail("That purchase order no longer exists.");

    const items = await listPoItems(id);
    const blockers = removalBlockers(items);
    if (blockers.length > 0) {
      const named = blockers.map((b) => `${b.itemCode} (${b.dispatchedQty})`).join(", ");
      return fail(
        `${existing.internalNo} has dispatches against ${named} and cannot be removed. Cancel it instead — that keeps the delivery history intact.`,
      );
    }

    await db.transaction(async (tx) => {
      for (const item of items) await auditedSoftDelete(actor, poItem, item.id, tx);
      await auditedSoftDelete(actor, purchaseOrder, id, tx);
    });

    revalidatePath("/purchase-orders");
    // Server redirect, for the reason removePoItemAction gives (J13): this
    // order's own screen now reads a row that no longer exists.
    redirect(
      `/purchase-orders?removed=${encodeURIComponent(`${existing.internalNo} removed.`)}`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not remove the purchase order."));
  }
}

/* -------------------------------------------------------------------------- */
/* Cancel — the second of B5's two sanctioned status writers                    */
/* -------------------------------------------------------------------------- */

/**
 * Cancelling an item, and putting it back.
 *
 * This and the recompute function are the ONLY writers of po_item.status
 * (decision B5), and the database enforces that: withStatusWrite opens a
 * transaction-local setting that the guard trigger checks. The write still goes
 * through the audit wrapper, so a cancellation is logged like everything else.
 *
 * Reinstating sets the status back to Open and then recomputes, rather than
 * assuming Open is right — an item that was fully dispatched before being
 * cancelled belongs at Closed, and guessing would produce an item that says
 * Open with nothing left to deliver.
 */
export async function setPoItemCancelledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const id = String(formData.get("id") ?? "");
    const cancel = String(formData.get("cancel")) === "true";

    const existing = await getPoItem(id);
    if (!existing) return fail("That item no longer exists.");

    await db.transaction(async (tx) => {
      await withStatusWrite(tx, () =>
        auditedUpdate(actor, poItem, id, { status: cancel ? "Cancelled" : "Open" }, tx),
      );

      // Let the derived answer settle it, rather than assuming Open.
      if (!cancel) await recomputeForPoItem(id, tx);
    });

    revalidatePath(`/purchase-orders/${existing.purchaseOrderId}`);
    return ok({
      message: cancel
        ? `${existing.itemCode} cancelled.`
        : `${existing.itemCode} reinstated.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not change the item."));
  }
}

/* -------------------------------------------------------------------------- */
/* Manual job close — section X                                                */
/* -------------------------------------------------------------------------- */

/**
 * Who may close a job by hand: "the DEO and admin and owner" (Utkarsh, 18 Nov
 * 2026).
 *
 * WHY THIS IS A ROLE LIST AND NOT `requireAccess("purchase_order", "write")`.
 * Two of the three already have that grant. OWNER has `purchase_order: "read"`
 * and always will — B2 makes him read-only everywhere, and widening the matrix
 * to let him reach one button would hand him the whole order book. So the gate
 * is the role list here plus the fourth B2 exception in src/db/audit.ts, which
 * is where the actual refusal lives. `requireAccess(..., "read")` still runs
 * first, so an unauthenticated or stale session is turned away before the role
 * is even considered.
 *
 * DEO IS `DATA_ENTRY_FULL`, not `DATA_ENTRY`. The latter is the store's typist
 * — materials and the dashboard, no purchase_order access of any kind (O5) — so
 * a close granted to it would be a button on a screen the role cannot open.
 *
 * roles.ts warns that a power expressed as a role check rather than a resource
 * excludes future roles silently. That is accepted here and noted in that file:
 * this grant is deliberately not a resource, because its whole point is to
 * admit one role that must stay read-only on the resource.
 */
async function requireJobCloser(): Promise<Actor> {
  const user = await requireAccess("purchase_order", "read");
  if (!JOB_CLOSE_ROLES.has(user.role)) redirect("/forbidden");
  return { id: user.id, role: user.role };
}

/**
 * Closing a job that will never be completed, and reopening one.
 *
 * CLOSED IS NOT CANCELLED. Cancel says the order went away — it never
 * happened. This says we delivered what we were going to deliver and the
 * remainder is written off. Both exist; they are not alternatives to each
 * other, and the screen says so.
 *
 * HOW THE STATUS ACTUALLY CHANGES, and why there is no withStatusWrite here
 * unlike the Cancel action above. This writes the three manual-close columns
 * and NOTHING ELSE. po_item_manual_close_recompute_trg then fires and runs the
 * recompute, which opens the status lock inside the SQL function and derives
 * 'Closed' from the fact it has just been told. Status therefore stays derived
 * (B5) and this action never touches it, directly or by asking.
 *
 * THERE IS DELIBERATELY NO recomputeForPoItem() CALL HERE. An earlier draft had
 * one, and it masked a missing trigger: the columns changed, the status did not,
 * and only this screen happened to paper over it. po-status.ts is explicit that
 * the recompute "needs no help from here at all... there is no call site to
 * forget" — so the trigger is the mechanism and a second entry point gets the
 * same behaviour for free. tests/manual-close.test.ts asserts the status rather
 * than the columns, which is what found it.
 *
 * Reopening is the same move in reverse: clear the three columns and the same
 * trigger lets the dispatched quantity settle where the item belongs, rather
 * than assuming Open — an item fully delivered before it was closed returns as
 * Closed.
 *
 * THE WAITING PERIOD IS CHECKED TWICE, on purpose. Here, so the person is told
 * which date to come back on; and by po_item_manual_close_guard_trg in 0048,
 * which is what actually stops a script. Both read
 * manual_close_min_days_after_po, so they cannot drift apart.
 */
export async function setPoItemManuallyClosedAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCloser();
    const id = String(formData.get("id") ?? "");
    const close = String(formData.get("close")) === "true";

    const existing = await getPoItem(id);
    if (!existing) return fail("That item no longer exists.");

    if (!close) {
      await db.transaction(async (tx) => {
        await auditedUpdate(
          actor,
          poItem,
          id,
          { closedManuallyAt: null, closedBy: null, closeReason: null },
          tx,
        );
      });

      revalidatePath(`/purchase-orders/${existing.purchaseOrderId}`);
      return ok({ message: `${existing.itemCode} reopened.` });
    }

    if (existing.closedManuallyAt) {
      return fail(`${existing.itemCode} is already closed.`);
    }

    /*
     * A cancelled order was never delivered at all, so there is no shortfall to
     * accept — and the recompute returns early on 'Cancelled', so a close
     * written here would store the columns and change nothing visible. Refusing
     * it says which of the two decisions is being asked for.
     */
    if (existing.status === "Cancelled") {
      return fail(
        `${existing.itemCode} is cancelled, so there is nothing to close. Reinstate it first if the order was real after all.`,
      );
    }

    const parsed = closeReasonSchema.safeParse({ reason: formData.get("reason") });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "That reason was not accepted.");
    }

    const fence = await manualCloseEligibility(id);
    if (!fence) return fail("That item no longer exists.");
    if (!fence.eligible) {
      return fail(
        `${existing.itemCode} cannot be closed by hand yet. Its PO is dated ${fence.poDate}, ` +
          `so the earliest is ${fence.earliest} — ${fence.minDays} days after. ` +
          `If the order went away rather than fell short, cancel it instead.`,
      );
    }

    await db.transaction(async (tx) => {
      await auditedUpdate(
        actor,
        poItem,
        id,
        {
          closedManuallyAt: new Date(),
          closedBy: actor.id,
          closeReason: parsed.data.reason,
        },
        tx,
      );
    });

    revalidatePath(`/purchase-orders/${existing.purchaseOrderId}`);
    return ok({ message: `${existing.itemCode} closed.` });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not close the job."));
  }
}

/**
 * Cancelling a PO cancels its open items too.
 *
 * Otherwise the header reads Cancelled while its items stay Open, and they go
 * on appearing in the Item Tracker and on Stage Update as live work against a
 * dead order — which is exactly the "stop asking people" failure the tracker
 * exists to prevent. Already-Closed items are left alone: they were delivered,
 * and that happened.
 */
export async function setPurchaseOrderCancelledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();
    const id = String(formData.get("id") ?? "");
    const cancel = String(formData.get("cancel")) === "true";

    const existing = await getPurchaseOrder(id);
    if (!existing) return fail("That purchase order no longer exists.");

    const affected = await db.transaction(async (tx) => {
      const items = await tx
        .select({ id: poItem.id, status: poItem.status })
        .from(poItem)
        .where(and(eq(poItem.purchaseOrderId, id), isNull(poItem.deletedAt)));

      let touched = 0;

      await withStatusWrite(tx, async () => {
        await auditedUpdate(
          actor,
          purchaseOrder,
          id,
          { status: cancel ? "Cancelled" : "Open" },
          tx,
        );

        for (const item of items) {
          if (cancel && item.status === "Open") {
            await auditedUpdate(actor, poItem, item.id, { status: "Cancelled" }, tx);
            touched += 1;
          } else if (!cancel && item.status === "Cancelled") {
            await auditedUpdate(actor, poItem, item.id, { status: "Open" }, tx);
            touched += 1;
          }
        }
      });

      // Recompute settles both the items and the header on their derived
      // values. On cancel it is a no-op, because Cancelled is never derived
      // away.
      for (const item of items) await recomputeForPoItem(item.id, tx);

      return touched;
    });

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);

    return ok({
      message: cancel
        ? `${existing.internalNo} cancelled, with ${affected} open item${affected === 1 ? "" : "s"}.`
        : `${existing.internalNo} reinstated.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not change the purchase order."));
  }
}

/* -------------------------------------------------------------------------- */
/* Merging items that share a name (N4)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Folds several same-named items on one PO into the earliest of them.
 *
 * UTKARSH ASKED FOR THIS KNOWING WHAT IT COSTS. N2 refused to add a repeat's
 * quantity onto the item it repeats, and the reasoning has not changed: one
 * row holds one committed date, so folding 5,000 due 5 Oct into 4,000 due
 * 15 Nov leaves one promise recorded and one gone, and OTD then measures the
 * whole 9,000 against whichever survived. He was shown that and chose it, so
 * the job here is to make it deliberate rather than to prevent it.
 *
 * Three things make it deliberate:
 *
 *   - The DATE IS CHOSEN, never inferred. When the group's dates differ the
 *     form makes somebody pick, and the action refuses a merge that does not
 *     name one. Picking silently — earliest, or the survivor's — would be the
 *     system quietly deciding which promise to keep.
 *   - NOTHING DISPATCHED MAY BE MERGED, the same rule removal has and for the
 *     same reason: the absorbed item is soft-deleted, and a live dispatch_line
 *     pointing at a row nothing displays would leave the challan saying it
 *     went out with nothing to say it against.
 *   - THE SURVIVOR CARRIES THE RECORD. Its remark gains a line naming each
 *     item folded in and its quantity, so the 9,000 can still be read back as
 *     the 5,000 and the 4,000 it came from. The audit log has the rest.
 *
 * Stage events on the absorbed items are NOT repointed. They are append-only
 * (C6) and repointing them would mean updating rows the database refuses to
 * update; they stay against their own item, which is soft-deleted, exactly as
 * they do when an item is removed today.
 */
export async function mergePoItemsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();

    const survivorId = String(formData.get("survivorId") ?? "");
    const absorbedIds = formData.getAll("absorbedId").map(String).filter(Boolean);
    const committedDate = String(formData.get("committedDate") ?? "").trim();

    if (!survivorId || absorbedIds.length === 0) {
      return fail("Nothing to merge.");
    }
    if (absorbedIds.includes(survivorId)) {
      return fail("An item cannot be merged into itself.");
    }

    const survivor = await getPoItem(survivorId);
    if (!survivor) return fail("That item no longer exists.");

    const absorbed: NonNullable<Awaited<ReturnType<typeof getPoItem>>>[] = [];
    for (const id of absorbedIds) {
      const row = await getPoItem(id);
      if (!row) return fail("One of the items no longer exists. Reload and try again.");
      if (row.purchaseOrderId !== survivor.purchaseOrderId) {
        return fail("Items can only be merged within one purchase order.");
      }
      absorbed.push(row);
    }

    // Same rule as removal: a delivery already recorded against an item is a
    // fact, and soft-deleting the item it points at would orphan the challan.
    for (const row of [survivor, ...absorbed]) {
      const dispatched = await dispatchedQtyFor(row.id);
      if (dispatched > 0) {
        return fail(
          `${row.itemCode} has ${dispatched} dispatched against it and cannot be merged. Cancel it instead, or merge the rest.`,
        );
      }
    }

    /*
     * The date is the caller's, and it is required whenever the group does not
     * already agree. An item with no committed date at all is the historical
     * import case (F8), and merging into one is allowed only if every item in
     * the group is likewise blank.
     */
    const dates = new Set([survivor, ...absorbed].map((r) => r.committedDate ?? ""));
    if (dates.size > 1 && !committedDate) {
      return fail(
        "These items promise different dates. Choose which one the merged item keeps.",
      );
    }
    const finalDate = committedDate || survivor.committedDate;

    const totalQty =
      survivor.orderedQty + absorbed.reduce((n, r) => n + r.orderedQty, 0);

    const foldedIn = absorbed
      .map((r) => `${r.itemCode} (${r.orderedQty})`)
      .join(", ");
    const note = `Merged in ${foldedIn}. Ordered quantity is the total of all of them.`;
    const remarks = survivor.remarks ? `${survivor.remarks}\n${note}` : note;

    await db.transaction(async (tx) => {
      await withStatusWrite(tx, async () => {
        await auditedUpdate(
          actor,
          poItem,
          survivor.id,
          { orderedQty: totalQty, committedDate: finalDate, remarks },
          tx,
        );
        for (const row of absorbed) await auditedSoftDelete(actor, poItem, row.id, tx);
      });
      await recomputeForPoItem(survivor.id, tx);
    });

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${survivor.purchaseOrderId}`);

    return ok({
      message: `${absorbed.length} item${absorbed.length === 1 ? "" : "s"} merged into ${survivor.itemCode}, now ${totalQty} ordered.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not merge the items."));
  }
}
