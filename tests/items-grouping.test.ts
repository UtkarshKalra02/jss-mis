import { describe, expect, it } from "vitest";

import {
  NOT_STARTED,
  NO_COMMITMENT_LABEL,
  filterSummary,
  groupItems,
} from "@/modules/items/grouping";
import type { ItemSearchRow } from "@/modules/items/queries";
import type { StageOption } from "@/modules/stage-update/precedence";

/**
 * Arranging pending work for the printed sheet (K16, extended by K17).
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
    clientId: "client-a",
    poInternalNo: "PO-2026-0001",
    clientPoNo: null,
    poDate: "2026-08-01",
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
    expect(groupItems(rows, "stage", STAGES).map((g) => g.key)).toEqual([
      "DESIGN",
      "LAMINATION",
    ]);
  });

  it("omits stages holding nothing", () => {
    const groups = groupItems([row()], "stage", STAGES);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("PRINTING");
  });

  it("puts work that has not started FIRST, not last", () => {
    const rows = [
      row({ currentStage: "PRINTING", currentStageName: "Printing" }),
      row({ currentStage: null, currentStageName: null }),
    ];

    const groups = groupItems(rows, "stage", STAGES);

    // Work nobody has begun is what this sheet exists to surface. Below
    // fourteen stage blocks it would never be read.
    expect(groups[0]!.key).toBeNull();
    expect(groups[0]!.label).toBe(NOT_STARTED);
  });

  it("totals the pieces owed in each block", () => {
    const rows = [
      row({ pendingQty: 250 }),
      row({ pendingQty: 400 }),
      row({ currentStage: "DESIGN", currentStageName: "Design", pendingQty: 90 }),
    ];

    const groups = groupItems(rows, "stage", STAGES);

    expect(groups.find((g) => g.key === "PRINTING")!.pendingQty).toBe(650);
    expect(groups.find((g) => g.key === "DESIGN")!.pendingQty).toBe(90);
  });

  it("never drops an item whose stage is no longer in the stage table", () => {
    // Reachable for real: a stage is deactivated after items passed through it,
    // and stage_event is append-only (C6) so the history still points at it.
    // A sheet headed "all pending work" must not quietly omit some.
    const rows = [row({ currentStage: "RETIRED", currentStageName: "Retired" }), row()];

    const groups = groupItems(rows, "stage", STAGES);

    expect(groups.map((g) => g.key)).toContain("RETIRED");
    expect(groups.flatMap((g) => g.rows)).toHaveLength(2);
  });
});

describe("grouping by client", () => {
  it("keys off the client id, not the name", () => {
    // Two clients can be typed with the same name — the importer creates them
    // and F32 allows it. Grouping by name would merge two customers' work onto
    // one block, which is the one mistake this sheet must never make.
    const rows = [
      row({ clientId: "c1", clientCode: "AAA", clientName: "Same Name Ltd" }),
      row({ clientId: "c2", clientCode: "BBB", clientName: "Same Name Ltd" }),
    ];

    expect(groupItems(rows, "client", STAGES)).toHaveLength(2);
  });

  it("orders blocks alphabetically, which is how somebody scans for a name", () => {
    const rows = [
      row({ clientId: "z", clientCode: "ZZZ", clientName: "Zenith" }),
      row({ clientId: "a", clientCode: "AAA", clientName: "Apex" }),
    ];

    expect(groupItems(rows, "client", STAGES).map((g) => g.key)).toEqual(["a", "z"]);
  });
});

describe("grouping by month due", () => {
  it("orders months chronologically, not by size", () => {
    const rows = [
      row({ committedDate: "2026-11-15" }),
      row({ committedDate: "2026-09-02" }),
      row({ committedDate: "2026-09-20" }),
    ];

    expect(groupItems(rows, "month", STAGES).map((g) => g.key)).toEqual(["2026-09", "2026-11"]);
  });

  it("puts work with no commitment LAST, unlike not-started work", () => {
    const rows = [row({ committedDate: null }), row({ committedDate: "2026-09-02" })];

    const groups = groupItems(rows, "month", STAGES);

    // An item with no committed date cannot be late, so it does not belong at
    // the top of a page about what is due (F8). Not-started work is the
    // opposite case and sorts first — see the stage tests above.
    expect(groups.at(-1)!.key).toBeNull();
    expect(groups.at(-1)!.label).toBe(NO_COMMITMENT_LABEL);
  });

  it("groups by the COMMITTED date, not the PO date the range filters on", () => {
    // The two dates are deliberately different. An order taken in August and
    // due in October belongs under October here.
    const rows = [row({ poDate: "2026-08-01", committedDate: "2026-10-05" })];

    expect(groupItems(rows, "month", STAGES)[0]!.key).toBe("2026-10");
  });
});

describe("row order inside a block", () => {
  it("is inherited from the query and never recomputed", () => {
    // The sort is applied in SQL so the row cap takes the right rows. Blocks
    // preserve what they were given; re-sorting here would print a different
    // thousand rows from the ones the limit selected.
    const first = row({ itemCode: "ITM-ZZZ", pendingQty: 1 });
    const second = row({ itemCode: "ITM-AAA", pendingQty: 9999 });

    const [printing] = groupItems([first, second], "stage", STAGES);

    expect(printing!.rows.map((r) => r.itemCode)).toEqual(["ITM-ZZZ", "ITM-AAA"]);
  });
});

describe("what the sheet says produced it", () => {
  it("names the clients and stages that were ticked", () => {
    const summary = filterSummary({
      query: "",
      clientNames: ["NMW", "KBC"],
      stageNames: ["Printing"],
    });

    expect(summary).toContain("NMW, KBC");
    expect(summary).toContain("Printing");
  });

  it("says the date range is on the ORDER date, not the due date", () => {
    const summary = filterSummary({
      query: "",
      clientNames: [],
      stageNames: [],
      poDateFrom: "2026-08-01",
      poDateTo: "2026-08-31",
    });

    // Unlabelled, a range would be read as whichever date the reader had in
    // mind — and this sheet also groups by committed date.
    expect(summary).toContain("ordered");
  });

  it("still says what it is showing when nothing is filtered", () => {
    // The unfiltered sheet is the one most likely to be mistaken for "the whole
    // picture" later, so it describes itself too rather than staying silent.
    expect(filterSummary({ query: "", clientNames: [], stageNames: [] })).toContain(
      "still owed",
    );
  });
});
