import { describe, expect, it } from "vitest";

import { indexGroups, indexSummary, nameKey } from "@/modules/purchase-orders/item-index";
import type { IndexItem } from "@/modules/purchase-orders/queries";

const it_ = (over: Partial<IndexItem>): IndexItem =>
  ({
    poItemId: over.itemCode ?? "x",
    itemCode: "ITM-1",
    itemName: "Mono carton",
    clientId: "c1",
    clientCode: "MUL",
    clientName: "Multani",
    purchaseOrderId: "po1",
    poInternalNo: "PO-2026-0001",
    poDate: "2026-09-01",
    designId: null,
    committedDate: "2026-10-05",
    status: "Open",
    orderedQty: 5000,
    dispatchedQty: 0,
    pendingQty: 5000,
    ...over,
  }) as IndexItem;

describe("the reconciliation pass (N5)", () => {
  it("folds case and internal spacing, which is how one product gets two names", () => {
    expect(nameKey("MASTER MONO CRT LTP (6 +1)")).toBe(nameKey("Master Mono CRT LTP (6 +1)"));
    expect(nameKey("  mono   carton ")).toBe("mono carton");
    // Genuinely different wording is NOT folded, and must not be.
    expect(nameKey("Mono carton")).not.toBe(nameKey("Mono carton outer"));
  });

  it("keeps two clients' identically named items apart", () => {
    const groups = indexGroups([
      it_({ itemCode: "ITM-1", clientId: "c1", clientCode: "MUL" }),
      it_({ itemCode: "ITM-2", clientId: "c2", clientCode: "NIC" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("adds up ordered, sent and pending across purchase orders", () => {
    const groups = indexGroups([
      it_({ itemCode: "ITM-1", purchaseOrderId: "po1", orderedQty: 5000, dispatchedQty: 9325, pendingQty: -4325, status: "Closed" }),
      it_({ itemCode: "ITM-2", purchaseOrderId: "po2", orderedQty: 5000, dispatchedQty: 0, pendingQty: 5000 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      purchaseOrders: 2,
      orderedQty: 10000,
      dispatchedQty: 9325,
      pendingQty: 675,
    });
  });

  it("flags the over-delivered item, which is the lumped-delivery signature", () => {
    const groups = indexGroups([
      it_({ itemCode: "ITM-1", pendingQty: -4325, dispatchedQty: 9325, status: "Closed" }),
      it_({ itemCode: "ITM-2" }),
    ]);
    expect(groups[0]!.overDelivered.map((i) => i.itemCode)).toEqual(["ITM-1"]);
  });

  it("flags an item settled while still owing", () => {
    const groups = indexGroups([
      it_({ itemCode: "ITM-1", status: "Closed", pendingQty: 200, dispatchedQty: 4800 }),
      it_({ itemCode: "ITM-2" }),
    ]);
    expect(groups[0]!.closedButOwing.map((i) => i.itemCode)).toEqual(["ITM-1"]);
  });

  it("counts the spellings it folded, so a merge is never silent", () => {
    const groups = indexGroups([
      it_({ itemCode: "ITM-1", itemName: "MASTER MONO CRT LTP (6 +1)" }),
      it_({ itemCode: "ITM-2", itemName: "Master Mono CRT LTP (6 +1)" }),
      it_({ itemCode: "ITM-3", itemName: "Master Mono CRT LTP (6 +1)" }),
    ]);
    expect(groups[0]!.spellings).toBe(2);
    // The commonest spelling represents the group.
    expect(groups[0]!.name).toBe("Master Mono CRT LTP (6 +1)");
  });

  it("sorts anything impossible above anything merely large", () => {
    const groups = indexGroups([
      it_({ itemCode: "ITM-1", itemName: "Big but fine", orderedQty: 90000, pendingQty: 90000 }),
      it_({ itemCode: "ITM-2", itemName: "Small but broken", pendingQty: -10, dispatchedQty: 5010, status: "Closed" }),
    ]);
    expect(groups[0]!.name).toBe("Small but broken");
  });

  it("summarises how much of this there is", () => {
    const summary = indexSummary(
      indexGroups([
        it_({ itemCode: "ITM-1", itemName: "A", pendingQty: -100, dispatchedQty: 5100, status: "Closed" }),
        it_({ itemCode: "ITM-2", itemName: "A" }),
        it_({ itemCode: "ITM-3", itemName: "B", designId: "d1" }),
      ]),
    );
    expect(summary).toMatchObject({
      groups: 2,
      items: 3,
      repeated: 1,
      overDelivered: 1,
      unlinked: 1,
      // -100 + 5000 + 5000: the over-delivery nets off against the rest.
      pendingQty: 9900,
    });
  });
});
