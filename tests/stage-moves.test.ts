import { describe, expect, it } from "vitest";

import { describeMoves, pairMoves } from "@/modules/stage-update/moves";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/**
 * K22: a stage update is a list of (item, stage) pairs, each row to its own
 * stage. These pin the wire format both views send and the sentence the
 * screen gets back.
 */
describe("pairing what the form sent", () => {
  it("pairs ids with stages positionally", () => {
    expect(pairMoves([A, B], ["PRINT", "LAM"])).toEqual({
      ok: true,
      moves: [
        { poItemId: A, stageCode: "PRINT" },
        { poItemId: B, stageCode: "LAM" },
      ],
    });
  });

  it("refuses a batch where any selected item has no stage", () => {
    const result = pairMoves([A, B], ["PRINT", ""]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/needs a stage/);
  });

  it("refuses lists that do not line up rather than dropping the last row", () => {
    expect(pairMoves([A, B], ["PRINT"]).ok).toBe(false);
  });

  it("refuses an empty batch", () => {
    expect(pairMoves([], []).ok).toBe(false);
  });

  it("lets the last pick win when the same item is sent twice", () => {
    expect(pairMoves([A, A], ["PRINT", "LAM"])).toEqual({
      ok: true,
      moves: [{ poItemId: A, stageCode: "LAM" }],
    });
  });
});

describe("saying what was done", () => {
  it("names the one stage when every item went to it", () => {
    expect(describeMoves([{ stageName: "Printing" }, { stageName: "Printing" }], 0)).toBe(
      "2 items moved to Printing.",
    );
  });

  it("breaks it down by stage when they differ, in first-seen order", () => {
    expect(
      describeMoves(
        [{ stageName: "Printing" }, { stageName: "Lamination" }, { stageName: "Printing" }],
        0,
      ),
    ).toBe("3 items moved — 2 to Printing, 1 to Lamination.");
  });

  it("mentions what was skipped", () => {
    expect(describeMoves([{ stageName: "Printing" }], 2)).toBe(
      "1 item moved to Printing. 2 skipped — no longer open.",
    );
  });
});
