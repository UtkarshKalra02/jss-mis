"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireAccess } from "@/auth/guard";
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
import { startOfDayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import {
  dispatchedQtyFor,
  findDuplicatePoNo,
  getPoItem,
  getPurchaseOrder,
} from "./queries";
import { createPoSchema, poHeaderSchema, poItemSchema } from "./validation";

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

/** Spec 6.3: PO capture belongs to ORDER_DESK (and ADMIN). */
async function requirePoWriter(): Promise<Actor> {
  const user = await requireAccess("purchase_order", "write");
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
    values: ReturnType<typeof poItemSchema.parse>;
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

  return columns.itemName.map((_, i) =>
    Object.fromEntries(ITEM_FIELDS.map((field) => [field, columns[field][i] ?? ""])),
  );
}

export async function createPurchaseOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePoWriter();

    const parsed = createPoSchema.safeParse({
      clientId: formData.get("clientId"),
      poNo: formData.get("poNo"),
      poDate: formData.get("poDate"),
      fileUrl: formData.get("fileUrl"),
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
          notes: orNull(v.notes),
        },
        tx,
      );

      for (const item of v.items) {
        await insertPoItem(actor, tx, {
          purchaseOrderId: po.id,
          poDate: v.poDate,
          values: item,
        });
      }

      return po;
    });

    revalidatePath("/purchase-orders");
    return ok({
      message: `${created.internalNo} captured with ${v.items.length} item${v.items.length === 1 ? "" : "s"}.`,
      redirectTo: `/purchase-orders/${created.id}`,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the purchase order.");
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
      notes: orNull(v.notes),
    });

    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    return ok({ message: "Saved." });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the changes.");
  }
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

function parseOneItem(formData: FormData) {
  return poItemSchema.safeParse({
    itemName: formData.get("itemName"),
    orderedQty: formData.get("orderedQty"),
    rate: formData.get("rate"),
    committedDate: formData.get("committedDate"),
    jobType: formData.get("jobType"),
    priority: formData.get("priority"),
    designId: formData.get("designId"),
    remarks: formData.get("remarks"),
  });
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

    const parsed = parseOneItem(formData);
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
    return fail(error instanceof Error ? error.message : "Could not add the item.");
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

    const parsed = parseOneItem(formData);
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
    return fail(error instanceof Error ? error.message : "Could not save the item.");
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
    // Back to the order. The item's own screen reads a row that no longer
    // exists, so returning without a destination 404s the confirmation (G11).
    return ok({
      message: `${existing.itemCode} removed.`,
      redirectTo: `/purchase-orders/${existing.purchaseOrderId}`,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not remove the item.");
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
    return fail(error instanceof Error ? error.message : "Could not change the item.");
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
    return fail(error instanceof Error ? error.message : "Could not change the purchase order.");
  }
}
