import { describe, expect, it } from "vitest";

import { removalBlockers } from "@/modules/purchase-orders/removal";

/**
 * A purchase order is removable only while nothing on it has been delivered
 * (K21). Status is not the test — a cancelled or closed item with nothing
 * dispatched is no bar — a challan is.
 */
describe("what stops a purchase order being removed", () => {
  it("is nothing, when nothing has been dispatched", () => {
    expect(
      removalBlockers([
        { itemCode: "NAT-001", dispatchedQty: 0 },
        { itemCode: "NAT-002", dispatchedQty: 0 },
      ]),
    ).toEqual([]);
  });

  it("names every item with a delivery against it, and only those", () => {
    expect(
      removalBlockers([
        { itemCode: "NAT-001", dispatchedQty: 0 },
        { itemCode: "NAT-002", dispatchedQty: 500 },
        { itemCode: "NAT-003", dispatchedQty: 1 },
      ]),
    ).toEqual([
      { itemCode: "NAT-002", dispatchedQty: 500 },
      { itemCode: "NAT-003", dispatchedQty: 1 },
    ]);
  });

  it("is nothing for an order with no items at all", () => {
    expect(removalBlockers([])).toEqual([]);
  });
});
