import type { StageUpdateRow } from "./queries";

/**
 * Collapsing a ganged plate into one row — decision H8, as a pure function.
 *
 * THE DATA IS NOT TOUCHED. H1 through H7 stand exactly as built: separate job
 * cards, separate clients, separate stage histories, separate dispatch and
 * separate OTD. What was wrong was the DISPLAY — Preeti and Ajay saw three
 * disconnected rows for what is physically one trip through the press, and
 * nothing on the screen said the plate was shared.
 *
 * Extracted from the component for the reason F25 gives for the stage
 * precedence rules: this is the logic most likely to be argued about later,
 * and an argument is far easier to settle against a test than against a
 * rendered table.
 */

/**
 * What a row has to carry to be grouped by plate.
 *
 * GENERIC SINCE THE PLANNING BOARD (L2). H8 wrote down that Phase 4 must
 * apply this same collapse rule and reuse these functions rather than grow a
 * second implementation. The board's rows are job cards, not items, so the
 * functions below are typed on the handful of fields they actually read and
 * both screens' row types satisfy them. Nothing about Stage Update's own
 * behaviour changed; `StageUpdateGroup` is the same shape it always was.
 */
export type GangableRow = {
  pressRunId: string | null;
  runNo: string | null;
  runDate: string | null;
  runMachine: string | null;
  currentStage: string | null;
  currentStageName: string | null;
  currentStageColour: string | null;
  clientCode: string;
};

export type ItemGroup<R = StageUpdateRow> = { kind: "item"; row: R };

export type RunGroup<R = StageUpdateRow> = {
  kind: "run";
  pressRunId: string;
  runNo: string;
  runDate: string | null;
  machine: string | null;
  /** The members that are still open work, in the order they arrived. */
  rows: R[];
  /**
   * Live job cards on the plate in total, including any already delivered and
   * therefore absent from `rows`. Null when the count is unknown.
   */
  totalCards: number | null;
};

export type StageUpdateGroup<R = StageUpdateRow> = ItemGroup<R> | RunGroup<R>;

/**
 * A run is collapsed only when TWO OR MORE of its jobs are on screen.
 *
 * A plate holding one live job is a real and common state — somebody starts a
 * run and adds the second job a minute later (H5) — and collapsing it would
 * add a click to reach a single item while protecting against nothing. The
 * danger H8 guards against is advancing SEVERAL clients' items in one press,
 * which needs at least two.
 */
const MIN_ROWS_TO_COLLAPSE = 2;

/**
 * Groups the stage update rows, preserving the order they arrive in.
 *
 * ORDER IS INHERITED, NOT RECOMPUTED. The rows come back overdue first, then
 * nearest commitment (the same ordering the Item Tracker uses), and a run takes
 * the position of its FIRST member — which is therefore its most urgent one.
 * Sorting runs by their own date instead would let a plate containing an
 * overdue job sink below fresh work, which is precisely the failure the sort
 * order exists to prevent.
 */
export function groupByPressRun<R extends GangableRow>(
  rows: readonly R[],
  totalCards?: ReadonlyMap<string, number>,
): StageUpdateGroup<R>[] {
  const membersByRun = new Map<string, R[]>();

  for (const row of rows) {
    if (!row.pressRunId) continue;
    const existing = membersByRun.get(row.pressRunId);
    if (existing) existing.push(row);
    else membersByRun.set(row.pressRunId, [row]);
  }

  const groups: StageUpdateGroup<R>[] = [];
  const emitted = new Set<string>();

  for (const row of rows) {
    const runId = row.pressRunId;
    const members = runId ? membersByRun.get(runId) : undefined;

    if (!runId || !members || members.length < MIN_ROWS_TO_COLLAPSE) {
      groups.push({ kind: "item", row });
      continue;
    }

    // The run takes the slot of its most urgent member, and appears once.
    if (emitted.has(runId)) continue;
    emitted.add(runId);

    groups.push({
      kind: "run",
      pressRunId: runId,
      runNo: row.runNo ?? runId,
      runDate: row.runDate,
      machine: row.runMachine,
      rows: members,
      totalCards: totalCards?.get(runId) ?? null,
    });
  }

  return groups;
}

/**
 * What the collapsed row says about where the plate's jobs are.
 *
 * A single stage is shown as that stage. SEVERAL STAGES ARE NEVER SHOWN AS
 * ONE. H2 deliberately refused any rule forcing ganged cards to move together
 * — they diverge the moment they come off the press, one to lamination and
 * another straight to die-cut — so a collapsed row displaying the earliest
 * pill would be asserting something the system took care not to be true.
 */
export function stageSummary(rows: readonly GangableRow[]): {
  kind: "single" | "mixed" | "none";
  name: string | null;
  colour: string | null;
  distinct: number;
} {
  const seen = new Map<string, { name: string | null; colour: string | null }>();

  for (const row of rows) {
    if (!row.currentStage) continue;
    if (!seen.has(row.currentStage)) {
      seen.set(row.currentStage, {
        name: row.currentStageName,
        colour: row.currentStageColour,
      });
    }
  }

  if (seen.size === 0) return { kind: "none", name: null, colour: null, distinct: 0 };

  if (seen.size === 1) {
    const [only] = [...seen.values()];
    return { kind: "single", name: only!.name, colour: only!.colour, distinct: 1 };
  }

  return { kind: "mixed", name: null, colour: null, distinct: seen.size };
}

/** Distinct clients on a plate. Cross-client is normal here and never a warning (H3). */
export function clientsOn(rows: readonly { clientCode: string }[]): string[] {
  return [...new Set(rows.map((r) => r.clientCode))];
}

/**
 * The ids a person is allowed to tick right now.
 *
 * THIS IS THE EXPANSION GATE (H8). A row inside a collapsed run is not
 * selectable, so the header's select-all cannot sweep up several clients'
 * items that nobody has looked at. Expanding a run puts its members back in
 * play — which is one extra click before an action that cannot be undone,
 * because `stage_event` is append-only (C6) and a correction is another
 * append, so a wrong bulk advance stays in the history for good.
 */
export function selectableRows<R>(
  groups: readonly StageUpdateGroup<R>[],
  expanded: ReadonlySet<string>,
): R[] {
  const rows: R[] = [];

  for (const group of groups) {
    if (group.kind === "item") rows.push(group.row);
    else if (expanded.has(group.pressRunId)) {
      for (const row of group.rows) rows.push(row);
    }
  }

  return rows;
}

/** The same gate, as item ids — what Stage Update ticks by. */
export function selectableIds(
  groups: readonly StageUpdateGroup<{ poItemId: string }>[],
  expanded: ReadonlySet<string>,
): string[] {
  return selectableRows(groups, expanded).map((row) => row.poItemId);
}

/**
 * The fields the search box looks in, for one row.
 *
 * Deliberately the same set the Item Tracker searches (6.4) plus the run
 * number, because the run is the thing this screen adds. Two screens that
 * disagree about what "search" means are two screens somebody has to learn
 * separately.
 */
function searchableFields(row: StageUpdateRow): (string | null)[] {
  return [
    row.itemCode,
    row.itemName,
    row.clientCode,
    row.clientName,
    row.poInternalNo,
    row.currentStageName,
    row.runNo,
  ];
}

/**
 * Whether one row answers the query.
 *
 * Every whitespace-separated term has to match SOME field, which is what makes
 * "kbc printing" find that client's jobs at the press rather than everything
 * mentioning either word. Empty query matches everything.
 */
export function rowMatches(row: StageUpdateRow, query: string): boolean {
  return fieldsMatch(searchableFields(row), query);
}

/** Every term has to land in some field. Empty query matches everything. */
export function fieldsMatch(fields: readonly (string | null)[], query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = fields.filter((f): f is string => !!f).map((f) => f.toLowerCase());

  return terms.every((term) => haystack.some((field) => field.includes(term)));
}

/**
 * Narrows the screen to what matches, WITHOUT breaking a plate up.
 *
 * A run is kept whole when any one of its jobs matches. Dropping the
 * non-matching members would leave a plate that says "3 jobs" above one row,
 * and — worse — a search that happened to leave a single member behind would
 * turn a ganged job into what looks like an ordinary standalone one, quietly
 * removing the expansion gate H8 exists to impose. Searching for one job and
 * being shown the plate it shares is the honest answer.
 */
export function filterGroups(
  groups: readonly StageUpdateGroup[],
  query: string,
): StageUpdateGroup[] {
  return filterGroupsBy(groups, query, searchableFields);
}

/**
 * The same rule for a screen whose rows are searched on different fields —
 * the planning board adds the job card number and searches cards, not items.
 */
export function filterGroupsBy<R>(
  groups: readonly StageUpdateGroup<R>[],
  query: string,
  fields: (row: R) => readonly (string | null)[],
): StageUpdateGroup<R>[] {
  if (query.trim() === "") return [...groups];

  return groups.filter((group) =>
    group.kind === "item"
      ? fieldsMatch(fields(group.row), query)
      : group.rows.some((row) => fieldsMatch(fields(row), query)),
  );
}

/** Every row currently on screen, in display order. */
export function rowsIn<R>(groups: readonly StageUpdateGroup<R>[]): R[] {
  return groups.flatMap((group) => (group.kind === "item" ? [group.row] : group.rows));
}
