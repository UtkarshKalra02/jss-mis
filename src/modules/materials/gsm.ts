/**
 * Which papers a job card may be offered, and in what order (decision O2).
 *
 * The rule Utkarsh gave: "if a job needs 300 GSM, 290 can also work". So the
 * picker does not filter to an exact GSM; it offers everything of the same
 * type and size within a tolerance, NEAREST FIRST, and the planner chooses.
 * The tolerance is a percentage from app_setting, not a fixed number of GSM,
 * because ±10 is generous on 100 GSM art paper and nothing on 400 GSM board.
 *
 * Pure, so the ordering can be argued about against a test rather than
 * against a screen. What it does NOT do is look at stock: the caller passes
 * candidates with their stock and this only decides membership and order.
 */

export type GsmCandidate = {
  gsm: number | null;
};

/** Inclusive: 300 at 5% admits 285 to 315. Never below 0 either side. */
export function gsmWindow(wanted: number, tolerancePct: number): { low: number; high: number } {
  const pct = Math.max(0, tolerancePct);
  const spread = (wanted * pct) / 100;
  return { low: Math.max(0, wanted - spread), high: wanted + spread };
}

/**
 * Filters to the window and orders by distance from the wanted GSM.
 *
 * Ties break HEAVIER FIRST: offered 290 and 310 for a 300 job, the heavier
 * sheet is the safer substitute on a press, and the order should say so.
 * Candidates with no GSM at all are excluded — there is nothing to compare.
 * A `wanted` of null or zero disables the filter entirely and returns
 * everything, unordered by GSM, because "no GSM asked for" is not "GSM 0".
 */
export function nearestGsm<T extends GsmCandidate>(
  candidates: T[],
  wanted: number | null | undefined,
  tolerancePct: number,
): T[] {
  if (!wanted || wanted <= 0) return candidates;

  const { low, high } = gsmWindow(wanted, tolerancePct);

  return candidates
    .filter((c) => c.gsm !== null && c.gsm >= low && c.gsm <= high)
    .sort((a, b) => {
      const da = Math.abs(a.gsm! - wanted);
      const db = Math.abs(b.gsm! - wanted);
      if (da !== db) return da - db;
      return b.gsm! - a.gsm!;
    });
}

/**
 * The papers to offer for a wanted type, size and GSM, nearest GSM first.
 *
 * Lives here, not in queries.ts, because the picker is a CLIENT component
 * and this file must stay free of the database: importing a function from
 * queries.ts pulls `@/db` — and its environment check — into the browser
 * bundle, which is a runtime error on the release form.
 */
export type PaperCandidate = GsmCandidate & {
  typeId: string;
  size: string | null;
};

export function paperCandidates<T extends PaperCandidate>(
  options: T[],
  wanted: { typeId?: string | null; size?: string | null; gsm?: number | null },
  tolerancePct: number,
): T[] {
  const pool = options.filter(
    (o) =>
      (!wanted.typeId || o.typeId === wanted.typeId) &&
      (!wanted.size || (o.size ?? "").toUpperCase() === wanted.size.toUpperCase()),
  );
  return nearestGsm(pool, wanted.gsm, tolerancePct);
}
