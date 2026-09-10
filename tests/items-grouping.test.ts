import { describe, expect, it } from "vitest";

import { NOT_STARTED, filterSummary, groupByStage } from "@/modules/items/grouping";
import type { ItemSearchRow } from "@/modules/items/queries";
import type { StageOption } from "@/modules/stage-update/precedence";

/**
 * Arranging pending work for the printed sheet (K16).
 *
 * Tested without a database or a browser, on the reasoning F25 gives for the
 * stage precedence rules: this is the logic somebody will argue about while
 * holding the paper — "why is that job under Printing?" — and an argument is
 * far easier to settle against a test than against a sheet of A4.
 */

let n = 0;

function row(over: Partial<ItemSearchRow> = {}): ItemSearchRow {
  n += 1;
  return {
    poItemId: `item-${n}`,
    itemCode: `ITM-${n}`,
    itemName: `Item ${n}`,
    clientCode: "AAA",
    clientName: "Client A",
    poInternalNo: "PO-2026-0001",
    clientPoNo: null,
    orderedQty: 1000,
    dispatchedQty: 0,
    pendingQty: 1000,
    currentStage: "PRINTING",
    currentStageName: "Printing",
    currentStageColour: "#000000",
    committedDate: "2026-06-01",
    daysToCommitted: 10,
    isOverdue: false,
    isAtRisk: false,
    status: "Open",
    priority: "Normal",
    ...over,
  };
}

const STAGES: StageOption[] = [
  { code: "DESIGN", name: "Design", colour: "#111", sequence: 40, isOptional: false, appliesTo: "All" },
  { code: "PRINTING", name: "Printing", colour: "#222", sequence: 70, isOptional: false, appliesTo: "All" },
  { code: "LAMINATION", name: "Lamination", colour: "#333", sequence: 80, isOptional: true, appliesTo: "All" },
];

describe("grouping pending work by stage", () => {
  it("orders blocks by the stage table's sequence, not by how much is in them", () => {
    const rows = [
      row({ currentStage: "LAMINATION", currentStageName: "Lamination" }),
      row({ currentStage: "LAMINATION", currentStageName: "Lamination" }),
      row({ currentStage: "LAMINATION", currentStageName: "Lamination" }),
      row({ currentStage: "DESIGN", currentStageName: "Design" }),
    ];

    // Lamination holds three and Design one; process order still wins, because
    // the sheet is read walking the floor.
    expect(groupByStage(rows, STAGES).map((g) => g.stageCode)).toEqual([
      "DESIGN",
      "LAMINATION",
    ]);
  });

  it("omits stages holding nothing", () => {
    const groups = groupByStage([row()], STAGES);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.stageCode).toBe("PRINTING");
  });

  it("puts work that has not started FIRST, not last", () => {
    const rows = [
      row({ currentStage: "PRINTING", currentStageName: "Printing" }),
      row({ currentStage: null, currentStageName: null }),
    ];

    const groups = groupByStage(rows, STAGES);

    // Work nobody has begun is what this sheet exists to surface. Below
    // fourteen stage blocks it would never be read.
    expect(groups[0]!.stageCode).toBeNull();
    expect(groups[0]!.stageName).toBe(NOT_STARTED);
  });

  it("totals the pieces owed in each block", () => {
    const rows = [
      row({ pendingQty: 250 }),
      row({ pendingQty: 400 }),
      row({ currentStage: "DESIGN", currentStageName: "Design", pendingQty: 90 }),
    ];

    const groups = groupByStage(rows, STAGES);

    expect(groups.find((g) => g.stageCode === "PRINTING")!.pendingQty).toBe(650);
    expect(groups.find((g) => g.stageCode === "DESIGN")!.pendingQty).toBe(90);
  });

  it("keeps the row order it was given inside each block", () => {
    const urgent = row({ itemCode: "ITM-URGENT", isOverdue: true });
    const later = row({ itemCode: "ITM-LATER" });

    const [printing] = groupByStage([urgent, later], STAGES);

    // Inherited, never recomputed — the rows arrive overdue first, so the most
    // urgent job in a stage is at the top of its block.
    expect(printing!.rows.map((r) => r.itemCode)).toEqual(["ITM-URGENT", "ITM-LATER"]);
  });

  it("never drops an item whose stage is no longer in the stage table", () => {
    // Reachable for real: a stage is deactivated after items passed through it,
    // and stage_event is append-only (C6) so the history still points at it.
    // A sheet headed "all pending work" must not quietly omit some.
    const rows = [row({ currentStage: "RETIRED", currentStageName: "Retired" }), row()];

    const groups = groupByStage(rows, STAGES);
    const codes = groups.map((g) => g.stageCode);

    expect(codes).toContain("RETIRED");
    expect(groups.flatMap((g) => g.rows)).toHaveLength(2);
  });
});

describe("what the sheet says produced it", () => {
  it("names the risk filter and the search term", () => {
    const summary = filterSummary({ query: "NAT", openOnly: true, risk: "overdue" });

    expect(summary).toContain("overdue items only");
    expect(summary).toContain("NAT");
  });

  it("says when delivered and cancelled work is included", () => {
    expect(filterSummary({ query: "", openOnly: false })).toContain("including delivered");
  });

  it("still says what it is showing when nothing is filtered", () => {
    // The unfiltered sheet is the one most likely to be mistaken for "the whole
    // picture" later, so it describes itself too rather than staying silent.
    expect(filterSummary({ query: "", openOnly: true })).toContain("open items");
  });
});
