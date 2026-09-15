"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor, type Tx } from "@/db/audit";
import { planEntry } from "@/db/schema";
import { actionError } from "@/lib/action-error";
import { formatDate } from "@/lib/format";

import {
  changedPositions,
  describeAdd,
  entrySchema,
  moveSchema,
  parseAddForm,
  pushSchema,
  qtySchema,
  reorder,
} from "./plan";
import { getPlanEntry, itemsByIds, siblingsOf, type PlanKind } from "./queries";

/**
 * The writes the planning board makes (M1–M3). All small, all on
 * `plan_entry`, all through the audit wrapper.
 *
 * Gated on `job_planning`, not `job_card`: the two are separate resources so
 * that raising a card does not hand somebody the board (J2).
 */

export type FormState = { ok: boolean; error: string | null; message?: string };

const ok = (message?: string): FormState => ({ ok: true, error: null, message });
const fail = (error: string): FormState => ({ ok: false, error });

async function requirePlanner(): Promise<Actor> {
  const user = await requireAccess("job_planning", "write");
  return { id: user.id, role: user.role };
}

function revalidate() {
  revalidatePath("/planning");
  revalidatePath("/dashboard");
}

/** Where a new line goes: after everything already on that day and kind. */
async function nextSequence(tx: Tx, date: string, kind: PlanKind): Promise<number> {
  const rows = await siblingsOf(date, kind, tx);
  return rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.sequence)) + 1;
}

/**
 * Puts items on a day's plan — at a station, or on the dispatch list.
 *
 * An item already on that day at that station is SKIPPED and counted, not
 * refused: the meeting ticks a dozen rows at once and one of them being
 * already there is not a reason to lose the other eleven. A closed or
 * fully-delivered item is refused by name, because a plan for it is a line
 * the floor would try to act on.
 *
 * A Dispatch line's quantity defaults to the item's pending quantity, read
 * from the view (M3); it is edited afterwards for a partial.
 */
export async function addToPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requirePlanner();

    const parsed = parseAddForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const items = await itemsByIds(v.poItemIds);
    if (items.length !== v.poItemIds.length) {
      return fail("Some of those items are no longer in the system. Reload the board.");
    }
    const closed = items.find((i) => i.status !== "Open" || i.pendingQty <= 0);
    if (closed) return fail(`${closed.itemCode} has nothing left to plan.`);

    const stageCode = v.kind === "Production" ? v.stageCode : null;
    const machineId = v.kind === "Production" && v.machineId !== "" ? v.machineId : null;

    let added = 0;
    let skipped = 0;

    await db.transaction(async (tx: Tx) => {
      const existing = await tx
        .select({ poItemId: planEntry.poItemId, stageCode: planEntry.stageCode })
        .from(planEntry)
        .where(
          and(
            eq(planEntry.planDate, v.planDate),
            eq(planEntry.kind, v.kind),
            isNull(planEntry.deletedAt),
          ),
        );
      const already = new Set(existing.map((e) => `${e.poItemId}|${e.stageCode ?? ""}`));

      let sequence = await nextSequence(tx, v.planDate, v.kind);

      for (const item of items) {
        if (already.has(`${item.poItemId}|${stageCode ?? ""}`)) {
          skipped += 1;
          continue;
        }
        await auditedInsert(
          actor,
          planEntry,
          {
            planDate: v.planDate,
            poItemId: item.poItemId,
            kind: v.kind,
            stageCode,
            machineId,
            sequence,
            plannedQty: v.kind === "Dispatch" ? item.pendingQty : null,
          },
          tx,
        );
        sequence += 1;
        added += 1;
      }
    });

    revalidate();
    return ok(describeAdd({ added, skipped, kind: v.kind, planDate: v.planDate }));
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not add to the plan."));
  }
}

/** Takes a line off the plan. A soft delete, so the decision stays on record. */
export async function removePlanEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePlanner();
    const parsed = entrySchema.safeParse({ entryId: formData.get("entryId") });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const entry = await getPlanEntry(parsed.data.entryId);
    if (!entry) return ok("That line was already off the plan.");

    await auditedSoftDelete(actor, planEntry, entry.id);
    revalidate();
    return ok("Taken off the plan.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not take that off the plan."));
  }
}

/**
 * Moves a line within its day — up, down, to the top, to the bottom (M2).
 *
 * "An urgent job comes in and the next job goes next": the line is put where
 * it belongs and the others shift. Only the positions that changed are
 * written, so putting the second line first writes two rows, not twenty.
 */
export async function movePlanEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePlanner();
    const parsed = moveSchema.safeParse({
      entryId: formData.get("entryId"),
      direction: formData.get("direction"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const entry = await getPlanEntry(parsed.data.entryId);
    if (!entry) return fail("That line is no longer on the plan. Reload the board.");

    await db.transaction(async (tx: Tx) => {
      const siblings = await siblingsOf(entry.planDate, entry.kind, tx);
      const before = siblings.map((s) => s.id);
      const after = reorder(before, entry.id, parsed.data.direction);
      for (const [id, sequence] of changedPositions(before, after)) {
        await auditedUpdate(actor, planEntry, id, { sequence }, tx);
      }
    });

    revalidate();
    return ok();
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not move that line."));
  }
}

/**
 * Pushes a line to another day — usually the next one, when today's list is
 * longer than the floor. It lands at the end of that day's queue.
 *
 * If the item is already on the target day at the same station, this line is
 * simply removed: two lines saying the same thing is not a plan.
 */
export async function pushPlanEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePlanner();
    const parsed = pushSchema.safeParse({
      entryId: formData.get("entryId"),
      toDate: formData.get("toDate"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const { entryId, toDate } = parsed.data;

    const entry = await getPlanEntry(entryId);
    if (!entry) return fail("That line is no longer on the plan. Reload the board.");
    if (entry.planDate === toDate) return ok();

    let merged = false;
    await db.transaction(async (tx: Tx) => {
      const [duplicate] = await tx
        .select({ id: planEntry.id })
        .from(planEntry)
        .where(
          and(
            eq(planEntry.planDate, toDate),
            eq(planEntry.kind, entry.kind),
            eq(planEntry.poItemId, entry.poItemId),
            entry.stageCode === null
              ? isNull(planEntry.stageCode)
              : eq(planEntry.stageCode, entry.stageCode),
            isNull(planEntry.deletedAt),
          ),
        )
        .limit(1);

      if (duplicate) {
        await auditedSoftDelete(actor, planEntry, entry.id, tx);
        merged = true;
        return;
      }

      await auditedUpdate(
        actor,
        planEntry,
        entry.id,
        { planDate: toDate, sequence: await nextSequence(tx, toDate, entry.kind) },
        tx,
      );
    });

    revalidate();
    return ok(
      merged
        ? `Already on ${formatDate(toDate)} — this line was removed.`
        : `Moved to ${formatDate(toDate)}.`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not move that line."));
  }
}

/** Edits a dispatch line's quantity, for a partial delivery (M3). */
export async function updatePlanQtyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePlanner();
    const parsed = qtySchema.safeParse({
      entryId: formData.get("entryId"),
      plannedQty: formData.get("plannedQty"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const entry = await getPlanEntry(parsed.data.entryId);
    if (!entry) return fail("That line is no longer on the plan. Reload the board.");
    if (entry.kind !== "Dispatch") return fail("Only a dispatch line carries a quantity.");
    if (entry.plannedQty === parsed.data.plannedQty) return ok();

    await auditedUpdate(actor, planEntry, entry.id, { plannedQty: parsed.data.plannedQty });
    revalidate();
    return ok("Quantity saved.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the quantity."));
  }
}
