import { describe, expect, it } from "vitest";

import { gsmWindow, nearestGsm } from "@/modules/materials/gsm";

/**
 * Decision O2: "if a job needs 300 GSM, 290 can also work". The picker offers
 * a window and orders it nearest first; the planner chooses.
 */

const paper = (gsm: number | null, name = `${gsm}`) => ({ gsm, name });

describe("the GSM window", () => {
  it("is a percentage either side, inclusive", () => {
    expect(gsmWindow(300, 5)).toEqual({ low: 285, high: 315 });
    expect(gsmWindow(100, 10)).toEqual({ low: 90, high: 110 });
  });

  it("never goes negative and treats a negative tolerance as zero", () => {
    expect(gsmWindow(300, -5)).toEqual({ low: 300, high: 300 });
  });
});

describe("nearest GSM first", () => {
  const stock = [paper(250), paper(330), paper(290), paper(300), paper(310), paper(null), paper(280)];

  it("keeps only papers inside the window and orders by distance", () => {
    const out = nearestGsm(stock, 300, 5).map((p) => p.gsm);
    // 285..315: 300, then 290/310 (tie → heavier first), 280 and 330 are out.
    expect(out).toEqual([300, 310, 290]);
  });

  it("puts the heavier sheet first on a tie — the safer substitute on a press", () => {
    const out = nearestGsm([paper(290), paper(310)], 300, 5).map((p) => p.gsm);
    expect(out).toEqual([310, 290]);
  });

  it("excludes papers with no GSM, because there is nothing to compare", () => {
    expect(nearestGsm([paper(null), paper(300)], 300, 5)).toHaveLength(1);
  });

  it("returns everything untouched when no GSM is asked for", () => {
    expect(nearestGsm(stock, null, 5)).toBe(stock);
    expect(nearestGsm(stock, 0, 5)).toBe(stock);
  });

  it("a wider tolerance admits more, in the same order", () => {
    // 264..336: 280 is 20 away and 330 is 30 away, so 280 comes first.
    const out = nearestGsm(stock, 300, 12).map((p) => p.gsm);
    expect(out).toEqual([300, 310, 290, 280, 330]);
  });
});
