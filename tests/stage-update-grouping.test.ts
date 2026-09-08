import { describe, expect, it } from "vitest";

import {
  clientsOn,
  filterGroups,
  groupByPressRun,
  rowMatches,
  rowsIn,
  selectableIds,
  stageSummary,
  type RunGroup,
} from "@/modules/stage-update/grouping";
import type { StageUpdateRow } from "@/modules/stage-update/queries";

/**
 * Collapsing a ganged plate on the floor-facing screen (decision H8).
 *
 * Tested without a database, a session or a browser, on exactly the reasoning
 * F25 gives for the stage precedence rules: this is the logic most likely to
 * be argued about later, and an argument is much easier to settle against a
 * test than against a rendered table.
 *
 * The safety property being pinned is the EXPANSION GATE. A wrong bulk move
 * across a plate advances several clients' items at once, each with its own
 * committed date feeding its own OTD, and `stage_event` is append-only (C6) —
 * a correction is another append, so the wrong event stays in the history for
 * good. There is no undo, which is why the gate is worth a test rather than a
 * comment.
 */

let n = 0;

function row(over: Partial<StageUpdateRow> = {}): StageUpdateRow {
  n += 1;
  return {
    poItemId: `item-${n}`,
    itemCode: `ITM-${n}`,
    itemName: `Item ${n}`,
    clientCode: "AAA",
    clientName: "Client A",
    poInternalNo: "PO-2026-0001",
    orderedQty: 1000,
    pendingQty: 1000,
    jobType: "New",
    priority: "Normal",
    currentStage: "PRINTING",
    currentStageName: "Printing",
    currentStageColour: "#4f46e5",
    currentStageSequence: 7,
    currentStageSince: null,
    committedDate: "2026-06-01",
    daysToCommitted: 10,
    isOverdue: false,
    isAtRisk: false,
    pressRunId: null,
    runNo: null,
    runDate: null,
    runMachine: null,
    ...over,
  };
}

function ganged(runId: string, over: Partial<StageUpdateRow> = {}): StageUpdateRow {
  return row({
    pressRunId: runId,
    runNo: `PR-2026-${runId}`,
    runDate: "2026-05-20",
    runMachine: "Heidelberg SM 74",
    ...over,
  });
}

describe("grouping a ganged plate", () => {
  it("leaves unganged items exactly as they were", () => {
    const rows = [row(), row(), row()];
    const groups = groupByPressRun(rows);

    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.kind === "item")).toBe(true);
  });

  it("collapses two jobs sharing a plate into one run", () => {
    const a = ganged("R1", { clientCode: "AAA" });
    const b = ganged("R1", { clientCode: "BBB" });

    const groups = groupByPressRun([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe("run");
    expect((groups[0] as RunGroup).rows).toHaveLength(2);
  });

  it("does NOT collapse a plate holding only one live job", () => {
    // Real and transient: somebody starts a run and adds the second job a
    // minute later (H5). Collapsing it would add a click to reach one item
    // while protecting against nothing.
    const groups = groupByPressRun([ganged("R1"), row()]);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "item")).toBe(true);
  });

  it("keeps the incoming order, so a run sits where its most urgent job sat", () => {
    // Rows arrive overdue-first, then nearest commitment. A run inheriting its
    // own date instead would let a plate carrying an overdue job sink below
    // fresh work — the exact failure the sort order exists to prevent.
    const overdue = ganged("R1", { isOverdue: true, itemCode: "ITM-URGENT" });
    const alsoOnPlate = ganged("R1", { itemCode: "ITM-CALM" });
    const standalone = row({ itemCode: "ITM-LATER" });

    const groups = groupByPressRun([overdue, standalone, alsoOnPlate]);

    expect(groups[0]!.kind).toBe("run");
    expect((groups[0] as RunGroup).rows[0]!.itemCode).toBe("ITM-URGENT");
    expect(groups[1]!.kind).toBe("item");
  });

  it("reports the plate's full size, not just what is still open", () => {
    // Stage Update lists open work only. A header claiming three jobs above
    // two visible rows is a worse lie than no number at all.
    const groups = groupByPressRun(
      [ganged("R1"), ganged("R1")],
      new Map([["R1", 3]]),
    );

    expect((groups[0] as RunGroup).totalCards).toBe(3);
    expect((groups[0] as RunGroup).rows).toHaveLength(2);
  });

  it("separates two different plates", () => {
    const groups = groupByPressRun([
      ganged("R1"),
      ganged("R2"),
      ganged("R1"),
      ganged("R2"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "run")).toBe(true);
  });
});

describe("what the collapsed row says about stage", () => {
  it("shows the one stage when every job is at it", () => {
    const summary = stageSummary([ganged("R1"), ganged("R1")]);
    expect(summary.kind).toBe("single");
    expect(summary.name).toBe("Printing");
  });

  it("NEVER reduces several stages to one pill", () => {
    // H2 deliberately refused any rule forcing ganged cards to move together —
    // they diverge the moment they come off the press, one to lamination and
    // another straight to die-cut. A single pill here would assert the thing
    // the system took care not to be true.
    const summary = stageSummary([
      ganged("R1"),
      ganged("R1", { currentStage: "DIE_CUT", currentStageName: "Die cut" }),
    ]);

    expect(summary.kind).toBe("mixed");
    expect(summary.distinct).toBe(2);
    expect(summary.name).toBeNull();
  });

  it("says nothing rather than guessing when no job has a stage", () => {
    const summary = stageSummary([
      ganged("R1", { currentStage: null, currentStageName: null }),
    ]);
    expect(summary.kind).toBe("none");
  });
});

describe("cross-client is normal here (H3)", () => {
  it("counts the clients on a plate without flagging them", () => {
    const clients = clientsOn([
      ganged("R1", { clientCode: "AAA" }),
      ganged("R1", { clientCode: "BBB" }),
      ganged("R1", { clientCode: "AAA" }),
    ]);

    expect(clients).toEqual(["AAA", "BBB"]);
  });
});

describe("the expansion gate", () => {
  it("makes a collapsed plate's jobs unselectable", () => {
    const groups = groupByPressRun([ganged("R1"), ganged("R1"), row()]);

    // Nothing expanded: only the standalone item can be ticked, so select-all
    // cannot sweep up two clients' jobs nobody has looked at.
    const ids = selectableIds(groups, new Set());
    expect(ids).toHaveLength(1);
  });

  it("puts the plate's jobs back in play once it is expanded", () => {
    const groups = groupByPressRun([ganged("R1"), ganged("R1"), row()]);

    const ids = selectableIds(groups, new Set(["R1"]));
    expect(ids).toHaveLength(3);
  });

  it("selects nothing from a plate that is not the expanded one", () => {
    const groups = groupByPressRun([ganged("R1"), ganged("R1"), ganged("R2"), ganged("R2")]);

    const ids = selectableIds(groups, new Set(["R2"]));
    expect(ids).toHaveLength(2);
  });
});

/**
 * The search box on Stage Update.
 *
 * Filtering happens in the browser here rather than in SQL — the screen
 * already holds every open item — so the matching rules are code rather than a
 * query, and they are pinned here for the same reason the grouping is. The
 * property that matters is the last test: narrowing the screen must not be
 * able to strip a plate down to what looks like an ordinary standalone row,
 * because that is the expansion gate H8 exists to impose disappearing quietly.
 */
describe("searching the stage update screen", () => {
  it("matches on any of the fields shown", () => {
    const r = row({
      itemCode: "NAT-2026-014",
      itemName: "Mono carton 300gsm",
      clientCode: "KBC",
      clientName: "Kaya Beauty Care",
      poInternalNo: "PO-2026-0044",
      currentStageName: "Printing",
    });

    for (const q of ["nat-2026", "carton", "kbc", "kaya", "0044", "printing"]) {
      expect(rowMatches(r, q)).toBe(true);
    }

    expect(rowMatches(r, "lamination")).toBe(false);
  });

  it("requires every term to match something, not just one of them", () => {
    const r = row({ clientCode: "KBC", currentStageName: "Printing" });

    expect(rowMatches(r, "kbc printing")).toBe(true);
    expect(rowMatches(r, "kbc lamination")).toBe(false);
  });

  it("treats an empty or blank query as no filter at all", () => {
    const groups = groupByPressRun([row(), row()]);

    expect(filterGroups(groups, "")).toHaveLength(2);
    expect(filterGroups(groups, "   ")).toHaveLength(2);
  });

  it("drops the items that do not match", () => {
    const keep = row({ itemCode: "NAT-2026-014" });
    const drop = row({ itemCode: "ABC-2026-001" });

    const visible = filterGroups(groupByPressRun([keep, drop]), "nat");

    expect(rowsIn(visible).map((r) => r.itemCode)).toEqual(["NAT-2026-014"]);
  });

  it("keeps a matched plate whole, members and all", () => {
    const wanted = ganged("R1", { clientCode: "KBC", itemCode: "NAT-2026-014" });
    const other = ganged("R1", { clientCode: "AAA", itemCode: "ABC-2026-001" });

    const visible = filterGroups(groupByPressRun([wanted, other]), "nat");

    // One group, still a run, still holding both jobs — searching for one job
    // shows the plate it shares rather than turning it into a standalone row
    // that could be advanced without anyone seeing whose it was (H8).
    expect(visible).toHaveLength(1);
    expect(visible[0]!.kind).toBe("run");
    expect((visible[0] as RunGroup).rows).toHaveLength(2);
    expect(selectableIds(visible, new Set())).toEqual([]);
  });
});
