import { and, eq, isNull } from "drizzle-orm";

import {
  auditedInsert,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
  type Tx,
} from "@/db/audit";
import { designFabrication, fabricationOptionValue, jobCardFabrication } from "@/db/schema";

/**
 * Writing fabrication selections, for a design and for a job card.
 *
 * ONE FUNCTION SHAPE FOR BOTH, because they are the same operation against two
 * tables: bring the stored selections to exactly what was posted. Writing them
 * separately is how the two drift into disagreeing about what an empty value
 * means.
 */

export type PostedSelection = {
  /** False records "this job does NOT have this process" (J24). */
  applies?: boolean;
  optionId: string;
  /** Absent for a tick-only option, and for a design row whose value is the run's. */
  valueId?: string | null;
  otherText?: string | null;
};

/**
 * Brings a design's fabrication specification to exactly `wanted`.
 *
 * REMOVED ROWS ARE SOFT-DELETED AND NEVER RESTORED. `design_fabrication` uses
 * the partial index the rest of the schema uses (C5), so a removed row is
 * invisible and re-adding is a genuine insert. The contrast this once drew was
 * with `syncProcesses` next door, which had to revive rows because
 * `design_process` carried a FULL unique constraint; both are gone (J22) and
 * the partial index is now simply the rule rather than the exception.
 *
 * That difference is the whole answer to the stale-value problem (J9). Taking
 * Foiling off a design and putting it back six months later must NOT bring
 * "Gold" back with it: on screen and in print, a resurrected value is
 * indistinguishable from one somebody chose, and the card would go to the
 * floor saying gold for a job that is silver. Re-adding starts empty, which is
 * a question somebody answers rather than an answer nobody gave.
 */
export async function syncDesignFabrication(
  actor: Actor,
  tx: Tx,
  designId: string,
  wanted: readonly PostedSelection[],
): Promise<void> {
  const live = await tx
    .select({
      id: designFabrication.id,
      optionId: designFabrication.optionId,
      valueId: designFabrication.valueId,
      otherText: designFabrication.otherText,
    })
    .from(designFabrication)
    .where(and(eq(designFabrication.designId, designId), isNull(designFabrication.deletedAt)));

  const byOption = new Map(live.map((r) => [r.optionId, r]));
  const target = new Map(wanted.map((w) => [w.optionId, w]));

  for (const [optionId, want] of target) {
    const existing = byOption.get(optionId);
    const valueId = want.valueId ?? null;
    const otherText = want.otherText ?? null;

    if (!existing) {
      await auditedInsert(
        actor,
        designFabrication,
        { designId, optionId, valueId, otherText },
        tx,
      );
      continue;
    }

    // Only write when something actually changed, so an untouched design does
    // not fill the audit log with rows saying nothing happened (F12's rule).
    if (existing.valueId !== valueId || existing.otherText !== otherText) {
      await auditedUpdate(actor, designFabrication, existing.id, { valueId, otherText }, tx);
    }
  }

  for (const [optionId, row] of byOption) {
    if (!target.has(optionId)) {
      await auditedSoftDelete(actor, designFabrication, row.id, tx);
    }
  }
}

/**
 * Records the run-scope answers on a job card: new die or old, and so on.
 *
 * SINCE J24 ANY OPTION MAY BE POSTED, not only the ones a design opened, and a
 * posted row may say the job does NOT have the process. Designs are not linked
 * to purchase orders in practice, so gating this on a design left most cards
 * with no finishing recorded at all.
 *
 * An option the card says nothing about gets NO ROW, which is how it keeps
 * falling through to the design. That is why removal here is a soft delete of
 * the row rather than writing `applies` false: "no opinion" and "explicitly
 * off" are different answers and the merge in printedChecklist reads them
 * differently.
 *
 * The database agrees independently about values: the composite foreign key
 * refuses a value belonging to another option, so a mangled form cannot record
 * "Gold" against the die.
 */
export async function syncJobCardFabrication(
  actor: Actor,
  tx: Tx,
  jobCardId: string,
  wanted: readonly PostedSelection[],
): Promise<void> {
  const live = await tx
    .select({
      id: jobCardFabrication.id,
      optionId: jobCardFabrication.optionId,
      valueId: jobCardFabrication.valueId,
      otherText: jobCardFabrication.otherText,
      applies: jobCardFabrication.applies,
    })
    .from(jobCardFabrication)
    .where(and(eq(jobCardFabrication.jobCardId, jobCardId), isNull(jobCardFabrication.deletedAt)));

  const byOption = new Map(live.map((r) => [r.optionId, r]));
  const target = new Map(wanted.map((w) => [w.optionId, w]));

  for (const [optionId, want] of target) {
    const existing = byOption.get(optionId);
    const applies = want.applies ?? true;

    // A process the job does not have carries no value. Keeping one would mean
    // turning Foiling back on silently restores "Gold", which is the resurrection
    // F17's partial index exists to prevent.
    const valueId = applies ? (want.valueId ?? null) : null;
    const otherText = applies ? (want.otherText ?? null) : null;

    if (!existing) {
      await auditedInsert(
        actor,
        jobCardFabrication,
        { jobCardId, optionId, valueId, otherText, applies },
        tx,
      );
      continue;
    }

    if (
      existing.valueId !== valueId ||
      existing.otherText !== otherText ||
      existing.applies !== applies
    ) {
      await auditedUpdate(
        actor,
        jobCardFabrication,
        existing.id,
        { valueId, otherText, applies },
        tx,
      );
    }
  }

  for (const [optionId, row] of byOption) {
    if (!target.has(optionId)) {
      await auditedSoftDelete(actor, jobCardFabrication, row.id, tx);
    }
  }
}

/**
 * Rejects a value that does not belong to the option it was posted against.
 *
 * The composite foreign key refuses this at the database, which is what makes
 * it true for a psql session and an import script as well (F11). Checking
 * first turns a constraint-violation string into a sentence naming the option.
 */
export async function unknownSelections(
  tx: Tx,
  wanted: readonly PostedSelection[],
): Promise<string[]> {
  const withValues = wanted.filter((w) => w.valueId);
  if (withValues.length === 0) return [];

  const rows = await tx
    .select({ id: fabricationOptionValue.id, optionId: fabricationOptionValue.optionId })
    .from(fabricationOptionValue)
    .where(isNull(fabricationOptionValue.deletedAt));

  const optionOf = new Map(rows.map((r) => [r.id, r.optionId]));

  return withValues
    .filter((w) => optionOf.get(w.valueId!) !== w.optionId)
    .map((w) => w.optionId);
}
