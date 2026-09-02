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

export type ItemGroup = { kind: "item"; row: StageUpdateRow };

export type RunGroup = {
  kind: "run";
  pressRunId: string;
  runNo: string;
  runDate: string | null;
  machine: string | null;
  /** The members that are still open work, in the order they arrived. */
  rows: StageUpdateRow[];
  /**
   * Live job cards on the plate in total, including any already delivered and
   * therefore absent from `rows`. Null when the count is unknown.
   */
  totalCards: number | null;
};

export type StageUpdateGroup = ItemGroup | RunGroup;

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
export function groupByPressRun(
  rows: readonly StageUpdateRow[],
  totalCards?: ReadonlyMap<string, number>,
): StageUpdateGroup[] {
  const membersByRun = new Map<string, StageUpdateRow[]>();

  for (const row of rows) {
    if (!row.pressRunId) continue;
    const existing = membersByRun.get(row.pressRunId);
    if (existing) existing.push(row);
    else membersByRun.set(row.pressRunId, [row]);
  }

  const groups: StageUpdateGroup[] = [];
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
export function stageSummary(rows: readonly StageUpdateRow[]): {
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
export function clientsOn(rows: readonly StageUpdateRow[]): string[] {
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
export function selectableIds(
  groups: readonly StageUpdateGroup[],
  expanded: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];

  for (const group of groups) {
    if (group.kind === "item") ids.push(group.row.poItemId);
    else if (expanded.has(group.pressRunId)) {
      for (const row of group.rows) ids.push(row.poItemId);
    }
  }

  return ids;
}
