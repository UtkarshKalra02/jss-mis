"use server";

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
import { dispatch, dispatchLine, stageEvent } from "@/db/schema";
import { startOfDayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import { getDispatch, itemsNowComplete } from "./queries";
import {
  createDispatchSchema,
  dispatchHeaderSchema,
  dispatchLineSchema,
} from "./validation";

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  redirectTo?: string;
};

const ok = (extra: Partial<FormState> = {}): FormState => ({ ok: true, error: null, ...extra });
const fail = (error: string): FormState => ({ ok: false, error });

/** Spec 6.8 plus decision B1: PLANNER and ACCOUNTS both do dispatch. */
async function requireDispatchWriter(): Promise<Actor> {
  const user = await requireAccess("dispatch", "write");
  return { id: user.id, role: user.role };
}

const orNull = (v: string | undefined) => v ?? null;

/* -------------------------------------------------------------------------- */
/* The DISPATCHED stage event                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Writes a DISPATCHED event for every item this challan just completed.
 *
 * Spec 6.8: the event is written "where fully dispatched". A partial delivery
 * does NOT move an item to DISPATCHED — the remainder is still in production,
 * and saying otherwise would take it off Stage Update while work continues on
 * it.
 *
 * Which items those are is read from v_po_item_status AFTER the lines are
 * written, not worked out from the form. pending_qty is derived
 * (non-negotiable 2), so the view is the only thing that knows whether a
 * partial delivery from last month already covered part of this order.
 *
 * event_at is the DISPATCH DATE, not now (decision F3). Backfilled history has
 * to read as history: a challan from March entered in August belongs in March,
 * and dating it today would compress months of deliveries into one afternoon
 * and make every ageing figure derived from them meaningless.
 */
async function writeDispatchedEvents(
  actor: Actor,
  tx: Tx,
  args: { poItemIds: string[]; dispatchDate: string },
): Promise<number> {
  const completed = await itemsNowComplete(tx, args.poItemIds);

  for (const poItemId of completed) {
    await auditedAppend(
      actor,
      stageEvent,
      {
        poItemId,
        stageCode: "DISPATCHED",
        eventAt: startOfDayIST(args.dispatchDate),
      },
      tx,
    );
  }

  return completed.length;
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

const LINE_FIELDS = ["poItemId", "qty", "rate"] as const;

/**
 * Lines post as parallel arrays, same scheme as PO capture.
 *
 * Rows the person left blank are dropped here rather than rejected: the form
 * lists every pending item for the client and they tick off the ones actually
 * going, so an untouched row is the normal case, not a mistake.
 */
function parseLines(formData: FormData): Record<string, string>[] {
  const columns = Object.fromEntries(
    LINE_FIELDS.map((field) => [field, formData.getAll(field).map(String)]),
  ) as Record<(typeof LINE_FIELDS)[number], string[]>;

  return columns.poItemId
    .map((_, i) =>
      Object.fromEntries(LINE_FIELDS.map((field) => [field, columns[field][i] ?? ""])),
    )
    .filter((row) => row.qty !== "" && Number(row.qty) > 0);
}

export async function createDispatchAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDispatchWriter();

    const parsed = createDispatchSchema.safeParse({
      clientId: formData.get("clientId"),
      dispatchDate: formData.get("dispatchDate"),
      status: formData.get("status"),
      vehicleNo: formData.get("vehicleNo"),
      transporter: formData.get("transporter"),
      ewayBillNo: formData.get("ewayBillNo"),
      remarks: formData.get("remarks"),
      lines: parseLines(formData),
    });

    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const result = await db.transaction(async (tx) => {
      const challanNo = await allocateNumber(tx, "CH", v.dispatchDate);

      const head = await auditedInsert(
        actor,
        dispatch,
        {
          challanNo,
          clientId: v.clientId,
          dispatchDate: v.dispatchDate,
          vehicleNo: orNull(v.vehicleNo),
          transporter: orNull(v.transporter),
          ewayBillNo: orNull(v.ewayBillNo),
          status: v.status,
          remarks: orNull(v.remarks),
        },
        tx,
      );

      for (const line of v.lines) {
        // The quantity ceiling and the client-agreement rule are enforced by
        // the trigger from migration 0001, which raises with a readable
        // message naming the item and the overflow.
        await auditedInsert(
          actor,
          dispatchLine,
          {
            dispatchId: head.id,
            poItemId: line.poItemId,
            qty: line.qty,
            rate: orNull(line.rate),
          },
          tx,
        );
      }

      const completed = await writeDispatchedEvents(actor, tx, {
        poItemIds: v.lines.map((l) => l.poItemId),
        dispatchDate: v.dispatchDate,
      });

      return { head, completed };
    });

    revalidatePath("/dispatch");
    revalidatePath("/items");

    return ok({
      message:
        `${result.head.challanNo} saved with ${v.lines.length} line${v.lines.length === 1 ? "" : "s"}` +
        (result.completed > 0
          ? `. ${result.completed} item${result.completed === 1 ? "" : "s"} now fully delivered.`
          : "."),
      redirectTo: `/dispatch/${result.head.id}`,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the dispatch.");
  }
}

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Editing the header can change the dispatch DATE, which is the date every
 * DISPATCHED event this challan wrote was stamped with. Those events are
 * append-only and are deliberately NOT rewritten — a correction to history is
 * an appended row, not an edit (C6). Changing the date going forward is
 * allowed; the events it already wrote stay where they are, and the timeline
 * shows both, which is the honest record of what happened.
 *
 * The client cannot be changed, because every line's item belongs to the
 * current one and the cross-client trigger would refuse. Moving a challan to
 * another client means entering it as a different challan.
 */
export async function updateDispatchHeaderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDispatchWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getDispatch(id);
    if (!existing) return fail("That dispatch no longer exists.");

    const parsed = dispatchHeaderSchema.safeParse({
      clientId: existing.clientId,
      dispatchDate: formData.get("dispatchDate"),
      status: formData.get("status"),
      vehicleNo: formData.get("vehicleNo"),
      transporter: formData.get("transporter"),
      ewayBillNo: formData.get("ewayBillNo"),
      remarks: formData.get("remarks"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    await auditedUpdate(actor, dispatch, id, {
      dispatchDate: v.dispatchDate,
      status: v.status,
      vehicleNo: orNull(v.vehicleNo),
      transporter: orNull(v.transporter),
      ewayBillNo: orNull(v.ewayBillNo),
      remarks: orNull(v.remarks),
    });

    revalidatePath("/dispatch");
    revalidatePath(`/dispatch/${id}`);
    revalidatePath("/items");
    return ok({ message: "Saved." });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the changes.");
  }
}

/* -------------------------------------------------------------------------- */
/* Lines                                                                       */
/* -------------------------------------------------------------------------- */

export async function addDispatchLineAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDispatchWriter();
    const dispatchId = String(formData.get("dispatchId") ?? "");

    const head = await getDispatch(dispatchId);
    if (!head) return fail("That dispatch no longer exists.");
    if (head.status === "Cancelled") {
      return fail("This challan is cancelled. Reinstate it before adding lines.");
    }

    const parsed = dispatchLineSchema.safeParse({
      poItemId: formData.get("poItemId"),
      qty: formData.get("qty"),
      rate: formData.get("rate"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    await db.transaction(async (tx) => {
      await auditedInsert(
        actor,
        dispatchLine,
        { dispatchId, poItemId: v.poItemId, qty: v.qty, rate: orNull(v.rate) },
        tx,
      );

      await writeDispatchedEvents(actor, tx, {
        poItemIds: [v.poItemId],
        dispatchDate: head.dispatchDate,
      });
    });

    revalidatePath(`/dispatch/${dispatchId}`);
    revalidatePath("/items");
    return ok({ message: "Line added." });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not add the line.");
  }
}

/**
 * Removing a line is a soft delete, which the recompute trigger notices — the
 * item's status settles back to Open if it was Closed.
 *
 * The DISPATCHED stage event it caused is NOT removed. stage_event is
 * append-only, and the item having reached DISPATCHED is a thing that happened.
 * Moving it back is a Stage Update away, and appears as a further row.
 */
export async function removeDispatchLineAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDispatchWriter();
    const id = String(formData.get("id") ?? "");
    const dispatchId = String(formData.get("dispatchId") ?? "");

    await auditedSoftDelete(actor, dispatchLine, id);

    revalidatePath(`/dispatch/${dispatchId}`);
    revalidatePath("/items");
    return ok({ message: "Line removed." });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not remove the line.");
  }
}

/* -------------------------------------------------------------------------- */
/* Cancel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cancelling a challan releases the quantity it consumed.
 *
 * Nothing here recomputes anything by hand: v_po_item_status excludes
 * cancelled challans, and the AFTER trigger on `dispatch` re-runs the status
 * recompute for every item on it (migration 0006). That trigger exists
 * precisely because cancelling a challan changes several items' dispatched
 * quantity without touching a single dispatch_line row.
 */
export async function setDispatchCancelledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDispatchWriter();
    const id = String(formData.get("id") ?? "");
    const cancel = String(formData.get("cancel")) === "true";

    const existing = await getDispatch(id);
    if (!existing) return fail("That dispatch no longer exists.");

    await auditedUpdate(actor, dispatch, id, {
      status: cancel ? "Cancelled" : "Dispatched",
    });

    revalidatePath("/dispatch");
    revalidatePath(`/dispatch/${id}`);
    revalidatePath("/items");

    return ok({
      message: cancel
        ? `${existing.challanNo} cancelled. Its quantity is owed again.`
        : `${existing.challanNo} reinstated.`,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not change the challan.");
  }
}
