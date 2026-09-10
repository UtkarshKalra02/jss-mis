import { formatDate } from "@/lib/format";
import type { StageOption } from "@/modules/stage-update/precedence";

import type { ItemSearchRow } from "./queries";
import type { GroupBy } from "./report-options";

/**
 * Arranging pending work for the printed sheet (K16, extended by K17).
 *
 * Extracted from the page for the same reason the Stage Update grouping was:
 * this is the logic somebody will argue about while holding the paper — "why
 * is that job under Printing?" — and an argument is far easier to settle
 * against a test than against a sheet of A4.
 *
 * GROUPING NEVER REORDERS ROWS. The sort is chosen by the person building the
 * report and applied in SQL, so what arrives here is already in the order they
 * asked for; every block below preserves it. Re-sorting here would mean the
 * cap took the top thousand by one ordering and the sheet printed another.
 */

export type ItemGroup = {
  /** Stable identity for React and for tests. Null is the "missing" bucket. */
  key: string | null;
  label: string;
  rows: ItemSearchRow[];
  /** Pieces still owed across the block, which is what a supervisor counts. */
  pendingQty: number;
};

/**
 * Work that has not started.
 *
 * NOT called "No stage", which reads as missing data. An item here has been
 * ordered and nothing has happened to it yet — a real state, and usually the
 * most interesting one on a pending-work sheet, because it is the work nobody
 * has picked up.
 */
export const NOT_STARTED = "Not started";

/**
 * Work with no committed date (F8).
 *
 * Historical rows imported from paper books genuinely have no commitment, and
 * inventing one would feed OTD. Under "month due" they group together and sort
 * LAST — unlike `NOT_STARTED`, which sorts first. The difference is deliberate:
 * unstarted work is urgent by omission, whereas an item with no commitment
 * cannot be late and does not belong at the top of a page about what is due.
 */
export const NO_COMMITMENT_LABEL = "No commitment recorded";

export function groupItems(
  rows: readonly ItemSearchRow[],
  groupBy: GroupBy,
  stages: readonly StageOption[],
): ItemGroup[] {
  if (groupBy === "client") return byClient(rows);
  if (groupBy === "month") return byMonthDue(rows);
  return byStage(rows, stages);
}

/* -------------------------------------------------------------------------- */

/**
 * ORDERED BY THE STAGE TABLE'S OWN SEQUENCE, not by how many items landed in
 * each. The sheet is read by somebody walking the floor in process order, and a
 * block order that changed every time the counts changed would be unreadable
 * two days running. Stages holding nothing are omitted — a printed list of
 * empty headings is noise on a page somebody has to carry.
 *
 * `NOT_STARTED` sorts FIRST. Work nobody has begun is what this sheet exists to
 * surface, and putting it after fourteen stage blocks buries it below the fold.
 */
function byStage(rows: readonly ItemSearchRow[], stages: readonly StageOption[]): ItemGroup[] {
  const buckets = collect(rows, (r) => r.currentStage ?? null);
  const groups: ItemGroup[] = [];

  const unstarted = buckets.get(null);
  if (unstarted) groups.push(group(null, NOT_STARTED, unstarted));

  for (const stage of [...stages].sort((a, b) => a.sequence - b.sequence)) {
    const found = buckets.get(stage.code);
    if (!found) continue;
    groups.push(group(stage.code, stage.name, found));
    buckets.delete(stage.code);
  }

  /*
   * A stage code the stage table no longer offers.
   *
   * Reachable in one real way: a stage is deactivated or renamed after items
   * have passed through it, and `stage_event` is append-only (C6) so the
   * history keeps pointing at it. Dropping those rows would mean a sheet
   * headed "all pending work" silently omitting some, which is the one thing
   * it must not do. Listed last, under the raw code.
   */
  for (const [code, found] of buckets) {
    if (code === null) continue;
    groups.push(group(code, code, found));
  }

  return groups;
}

/** Alphabetical by client name — the order somebody scans a sheet for a name. */
function byClient(rows: readonly ItemSearchRow[]): ItemGroup[] {
  const buckets = collect(rows, (r) => r.clientId);

  return [...buckets.entries()]
    .map(([id, found]) => group(id, `${found[0]!.clientCode} — ${found[0]!.clientName}`, found))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * By the calendar month of the COMMITTED date — what is landing when.
 *
 * Note this reads a different date from the report's range filter, which is on
 * PO date. That is not an oversight: "orders taken in August, grouped by when
 * they are due" is the capacity question worth asking, and the sheet labels
 * both dates so the two cannot be confused on paper.
 */
function byMonthDue(rows: readonly ItemSearchRow[]): ItemGroup[] {
  const buckets = collect(rows, (r) => (r.committedDate ? r.committedDate.slice(0, 7) : null));

  const dated = [...buckets.entries()]
    .filter(([key]) => key !== null)
    .sort(([a], [b]) => (a! < b! ? -1 : 1))
    .map(([key, found]) => group(key, monthLabel(key!), found));

  const undated = buckets.get(null);
  return undated ? [...dated, group(null, NO_COMMITMENT_LABEL, undated)] : dated;
}

/** "September 2026", from a YYYY-MM key. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/* -------------------------------------------------------------------------- */

function collect<K>(
  rows: readonly ItemSearchRow[],
  key: (row: ItemSearchRow) => K,
): Map<K, ItemSearchRow[]> {
  const out = new Map<K, ItemSearchRow[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = out.get(k);
    if (existing) existing.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function group(key: string | null, label: string, rows: ItemSearchRow[]): ItemGroup {
  return { key, label, rows, pendingQty: rows.reduce((sum, r) => sum + r.pendingQty, 0) };
}

/* -------------------------------------------------------------------------- */

/**
 * What the sheet says produced it.
 *
 * A printed subset that does not say it is a subset is the failure every
 * filtered screen in this system guards against — and it is worse on paper,
 * because the sheet outlives the filters that were set and nobody holding it
 * can see what was ticked. Every clause names what it narrowed, and the
 * unfiltered case still describes itself rather than staying silent.
 */
export function filterSummary(opts: {
  query: string;
  clientNames: readonly string[];
  stageNames: readonly string[];
  poDateFrom?: string;
  poDateTo?: string;
}): string {
  const parts: string[] = ["Open items with work still owed"];

  if (opts.clientNames.length > 0) parts.push(`clients: ${opts.clientNames.join(", ")}`);
  if (opts.stageNames.length > 0) parts.push(`stages: ${opts.stageNames.join(", ")}`);

  if (opts.poDateFrom || opts.poDateTo) {
    // Named explicitly as the PO date — the sheet also groups by committed
    // date, and an unlabelled range would be read as whichever the reader
    // happened to have in mind.
    const from = opts.poDateFrom ? formatDate(opts.poDateFrom) : "the beginning";
    const to = opts.poDateTo ? formatDate(opts.poDateTo) : "today";
    parts.push(`ordered ${from} to ${to}`);
  }

  if (opts.query.trim()) parts.push(`matching “${opts.query.trim()}”`);

  return parts.join(" · ");
}
