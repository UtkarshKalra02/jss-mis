import { describe, expect, it } from "vitest";

import { sameNameGroups } from "@/modules/purchase-orders/queries";
import type { PoItemRow } from "@/modules/purchase-orders/queries";

const item = (over: Partial<PoItemRow>): PoItemRow =>
  ({
    id: over.itemCode ?? "x",
    itemCode: "ITM-2026-00001",
    itemName: "Mono carton",
    orderedQty: 1000,
    dispatchedQty: 0,
    pendingQty: 1000,
    committedDate: "2026-10-05",
    status: "Open",
    ...over,
  }) as PoItemRow;

/**
 * N4's grouping. The merge itself needs a database; what is worth pinning
 * without one is which items are offered as a group at all, because that is
 * what decides whether somebody is shown the choice.
 */
describe("items on a PO that share a name (N4)", () => {
  it("groups by name ignoring case and surrounding space", () => {
    const groups = sameNameGroups([
      item({ itemCode: "ITM-1", itemName: "Mono Carton" }),
      item({ itemCode: "ITM-2", itemName: "mono carton " }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.itemCode)).toEqual(["ITM-1", "ITM-2"]);
    expect(groups[0]!.orderedQty).toBe(2000);
  });

  it("keeps the earliest item code first, which is the one kept", () => {
    const groups = sameNameGroups([
      item({ itemCode: "ITM-9" }),
      item({ itemCode: "ITM-3" }),
      item({ itemCode: "ITM-5" }),
    ]);
    expect(groups[0]!.items.map((i) => i.itemCode)).toEqual(["ITM-3", "ITM-5", "ITM-9"]);
  });

  it("an item with no twin is not a group", () => {
    expect(sameNameGroups([item({ itemCode: "ITM-1", itemName: "Alone" })])).toEqual([]);
  });

  it("flags when the group does not agree on a date", () => {
    const same = sameNameGroups([
      item({ itemCode: "ITM-1", committedDate: "2026-10-05" }),
      item({ itemCode: "ITM-2", committedDate: "2026-10-05" }),
    ]);
    expect(same[0]!.datesDiffer).toBe(false);

    const differ = sameNameGroups([
      item({ itemCode: "ITM-1", committedDate: "2026-10-05" }),
      item({ itemCode: "ITM-2", committedDate: "2026-11-15" }),
    ]);
    expect(differ[0]!.datesDiffer).toBe(true);
  });

  it("a blank committed date differs from a real one", () => {
    const groups = sameNameGroups([
      item({ itemCode: "ITM-1", committedDate: null }),
      item({ itemCode: "ITM-2", committedDate: "2026-11-15" }),
    ]);
    expect(groups[0]!.datesDiffer).toBe(true);
  });

  it("names the dispatched items, which is what blocks a merge", () => {
    const groups = sameNameGroups([
      item({ itemCode: "ITM-1", dispatchedQty: 0 }),
      item({ itemCode: "ITM-2", dispatchedQty: 400 }),
    ]);
    expect(groups[0]!.dispatched.map((i) => i.itemCode)).toEqual(["ITM-2"]);
  });

  it("leaves cancelled items out, so they neither group nor block", () => {
    const groups = sameNameGroups([
      item({ itemCode: "ITM-1" }),
      item({ itemCode: "ITM-2", status: "Cancelled" }),
    ]);
    expect(groups).toEqual([]);
  });
});
