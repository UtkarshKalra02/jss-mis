import { describe, expect, it } from "vitest";

import { totalsFor, type OrderBookItem } from "@/modules/designs/order-book";

const item = (o: number, d: number, overdue = false): OrderBookItem => ({
  orderedQty: o,
  dispatchedQty: d,
  pendingQty: o - d,
  isOverdue: overdue,
});

/**
 * The sum N2 declined to write onto a row. A client orders 5,000 of a design,
 * 3,000 go out, then they repeat for 4,000 more — two items, two promised
 * dates, and one honest total across them.
 */
describe("a design's order book (P7)", () => {
  it("adds the repeats up without either item being changed", () => {
    const rows = [item(5000, 3000), item(4000, 0)];
    expect(totalsFor(rows)).toEqual({
      ordered: 9000,
      dispatched: 3000,
      pending: 6000,
      openItems: 2,
      overdue: 0,
    });
  });

  it("counts only rows that still owe quantity as open", () => {
    const rows = [item(5000, 5000), item(4000, 1000)];
    const t = totalsFor(rows);
    expect(t.pending).toBe(3000);
    expect(t.openItems).toBe(1);
  });

  it("counts overdue items separately from open ones", () => {
    const rows = [item(100, 0, true), item(200, 0, true), item(300, 300, false)];
    const t = totalsFor(rows);
    expect(t.openItems).toBe(2);
    expect(t.overdue).toBe(2);
  });

  it("a design with nothing on order totals zero rather than failing", () => {
    expect(totalsFor([])).toEqual({
      ordered: 0,
      dispatched: 0,
      pending: 0,
      openItems: 0,
      overdue: 0,
    });
  });

  it("a fully delivered design still reports what was ordered", () => {
    const t = totalsFor([item(5000, 5000), item(4000, 4000)]);
    expect(t.ordered).toBe(9000);
    expect(t.pending).toBe(0);
    expect(t.openItems).toBe(0);
  });
});
