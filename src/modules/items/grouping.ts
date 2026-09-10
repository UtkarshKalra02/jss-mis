import type { StageOption } from "@/modules/stage-update/precedence";

import type { ItemSearchRow } from "./queries";

/**
 * Arranging pending work for the printed sheet (K16).
 *
 * Extracted from the page for the same reason the Stage Update grouping was:
 * this is the logic somebody will argue about later — "why is that job under
 * Printing when I moved it?" — and an argument is far easier to settle against
 * a test than against a sheet of A4.
 */

export type StageGroup = {
  /** Null for work that has never had a stage event. */
  stageCode: string | null;
  stageName: string;
  rows: ItemSearchRow[];
  /** Pieces still owed across the group, which is what a supervisor counts. */
  pendingQty: number;
};

/**
 * The label for work that has not started.
 *
 * It is NOT called "No stage", which reads as missing data. An item sitting
 * here has been ordered and nothing has happened to it yet, and that is a real
 * and interesting state on a pending-work sheet — usually the most interesting
 * one, because it is the work nobody has picked up.
 */
export const NOT_STARTED = "Not started";

/**
 * Groups open items under the stage they are sitting at.
 *
 * ORDERED BY THE STAGE TABLE'S OWN SEQUENCE, not by how many items landed in
 * each. The sheet is read by somebody walking the floor in process order, and a
 * block order that changed every time the counts changed would be unreadable
 * two days running. Stages holding nothing are omitted — a printed list of
 * empty headings is noise on a page somebody has to carry.
 *
 * `NOT_STARTED` sorts FIRST rather than last. Work nobody has begun is the
 * thing a pending-work sheet exists to surface, and putting it after fourteen
 * stage blocks buries it below the fold.
 *
 * Row order inside each block is inherited, never recomputed: the rows arrive
 * overdue first then nearest committed date, which is the ordering every
 * production screen shares, so the most urgent job in a stage is at the top of
 * its block.
 */
export function groupByStage(
  rows: readonly ItemSearchRow[],
  stages: readonly StageOption[],
): StageGroup[] {
  const byCode = new Map<string | null, ItemSearchRow[]>();

  for (const row of rows) {
    const key = row.currentStage ?? null;
    const existing = byCode.get(key);
    if (existing) existing.push(row);
    else byCode.set(key, [row]);
  }

  const groups: StageGroup[] = [];

  const unstarted = byCode.get(null);
  if (unstarted) {
    groups.push({
      stageCode: null,
      stageName: NOT_STARTED,
      rows: unstarted,
      pendingQty: totalPending(unstarted),
    });
  }

  for (const stage of [...stages].sort((a, b) => a.sequence - b.sequence)) {
    const found = byCode.get(stage.code);
    if (!found) continue;

    groups.push({
      stageCode: stage.code,
      stageName: stage.name,
      rows: found,
      pendingQty: totalPending(found),
    });
    byCode.delete(stage.code);
  }

  /*
   * A stage code on an item that the stage table no longer offers.
   *
   * Reachable in one real way: a stage is deactivated or renamed after items
   * have already passed through it, and `stage_event` is append-only (C6) so
   * the history keeps pointing at it. Dropping those rows would mean a sheet
   * headed "all pending work" silently omitting some, which is the one thing
   * it must not do. They are listed last under their own code.
   */
  for (const [code, found] of byCode) {
    if (code === null) continue;
    groups.push({
      stageCode: code,
      stageName: code,
      rows: found,
      pendingQty: totalPending(found),
    });
  }

  return groups;
}

function totalPending(rows: readonly ItemSearchRow[]): number {
  return rows.reduce((sum, r) => sum + r.pendingQty, 0);
}

/**
 * What the sheet says produced it.
 *
 * A printed subset that does not say it is a subset is the failure every
 * filtered screen in this system guards against — and it is worse on paper,
 * because the sheet outlives the screen whose filters were set, and nobody
 * holding it can see what was typed into the search box.
 */
export function filterSummary(opts: {
  query: string;
  openOnly: boolean;
  risk?: "overdue" | "at-risk";
}): string {
  const parts: string[] = [];

  if (opts.risk === "overdue") parts.push("overdue items only");
  else if (opts.risk === "at-risk") parts.push("at-risk items only");

  if (opts.query.trim()) parts.push(`matching “${opts.query.trim()}”`);

  parts.push(opts.openOnly ? "open items with work still owed" : "including delivered and cancelled");

  return parts.join(" · ");
}
