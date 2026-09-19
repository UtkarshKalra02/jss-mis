import { describe, expect, it } from "vitest";

import { formatSku, nextSkuNumber, skuNumber, skuPrefix } from "@/modules/materials/sku";

/** Decision O1: the sheet's SKU scheme, kept. */
describe("SKU codes", () => {
  it("builds the prefix from category and type codes, upper-cased", () => {
    expect(skuPrefix("p", "sbs")).toBe("P-SBS");
  });

  it("pads to three digits and no further", () => {
    expect(formatSku("P-SBS", 1)).toBe("P-SBS-001");
    expect(formatSku("P-SBS", 116)).toBe("P-SBS-116");
    expect(formatSku("P-SBS", 1234)).toBe("P-SBS-1234");
  });

  it("reads the number back only for its own prefix", () => {
    expect(skuNumber("P-SBS-007", "P-SBS")).toBe(7);
    expect(skuNumber("CH-SOL-116", "P-SBS")).toBeNull();
    expect(skuNumber("not a sku", "P-SBS")).toBeNull();
  });

  it("allocates max + 1 under the prefix, counting removed codes too", () => {
    expect(nextSkuNumber(["P-SBS-001", "P-SBS-009", "CH-SOL-200", "P-SBS-004"], "P-SBS")).toBe(10);
    expect(nextSkuNumber([], "P-SBS")).toBe(1);
  });
});
