import { describe, expect, it } from "vitest";

import {
  ITEM_NAME_THRESHOLD,
  nearbyItemNames,
  normaliseItemName,
  type NamedItem,
} from "@/modules/items/near-name";

/**
 * "Did you mean" for a typed item name (U2).
 *
 * The point of these tests is the BALANCE, not the mechanism. A warning that
 * fires too readily gets trained past and then protects nothing, so as many of
 * these assert silence as assert a suggestion.
 */

let n = 0;
const item = (itemName: string, itemCode = `ITM-2026-${String(++n).padStart(5, "0")}`): NamedItem => ({
  poItemId: `id-${itemCode}`,
  itemCode,
  itemName,
  status: "Open",
  poInternalNo: "PO-2026-0001",
});

describe("normaliseItemName", () => {
  it("folds case, spacing and punctuation", () => {
    expect(normaliseItemName("  Urea  Foot-Cream,  Carton ")).toBe("urea foot cream carton");
  });

  it("keeps trailing words, unlike the client normaliser", () => {
    // "Pvt Ltd" is noise on a company; "Insert" is the entire product.
    expect(normaliseItemName("Carton Insert")).not.toBe(normaliseItemName("Carton"));
  });
});

describe("nearbyItemNames", () => {
  const existing = [
    item("Urea Foot Cream Carton 50g"),
    item("Urea Foot Cream Carton 100g"),
    item("Shampoo Outer Box"),
  ];

  it("catches the same name typed differently", () => {
    const hits = nearbyItemNames("urea foot cream carton  50G", existing);
    expect(hits[0]!.exact).toBe(true);
    expect(hits[0]!.item.itemName).toBe("Urea Foot Cream Carton 50g");
  });

  it("ranks an exact match first even when others score well", () => {
    // Both 50g and 100g resemble it; only one of them IS it.
    const hits = nearbyItemNames("Urea Foot Cream Carton 100g", existing);
    expect(hits[0]!.exact).toBe(true);
    expect(hits[0]!.item.itemName).toBe("Urea Foot Cream Carton 100g");
  });

  it("catches a typo", () => {
    const hits = nearbyItemNames("Shampo Outer Box", existing);
    expect(hits.map((h) => h.item.itemName)).toContain("Shampoo Outer Box");
    expect(hits[0]!.exact).toBe(false);
  });

  it("says nothing about a genuinely different product", () => {
    expect(nearbyItemNames("Lipstick Sleeve", existing)).toEqual([]);
  });

  it("says nothing while the name is too short to judge", () => {
    // Three characters resemble half the catalogue.
    expect(nearbyItemNames("Ure", existing)).toEqual([]);
    expect(nearbyItemNames("", existing)).toEqual([]);
  });

  it("warns but does not decide — it only ever returns candidates", () => {
    const hits = nearbyItemNames("Urea Foot Cream Carton", existing);
    // A new size is a perfectly good reason to type something similar, so the
    // result is a list to glance at, never a verdict.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => typeof h.score === "number")).toBe(true);
  });

  it("holds to its limit, closest first", () => {
    const many = [
      item("Carton Box Small"),
      item("Carton Box Smaller"),
      item("Carton Box Smallest"),
      item("Carton Box Smal"),
    ];
    const hits = nearbyItemNames("Carton Box Small", many, 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
  });

  it("ignores an item whose name is blank", () => {
    expect(nearbyItemNames("Urea Foot Cream Carton 50g", [item("")])).toEqual([]);
  });

  it("uses a higher bar than the importer, on purpose", () => {
    // Documented reasoning: a false positive here lands on somebody mid-form,
    // and item names within one client share far more words than client names.
    expect(ITEM_NAME_THRESHOLD).toBeGreaterThan(0.45);
  });
});
