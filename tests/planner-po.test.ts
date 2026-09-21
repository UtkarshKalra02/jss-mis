import { describe, expect, it } from "vitest";

import { can } from "@/auth/roles";

/**
 * Decision P5: the PLANNER captures purchase orders, and only captures them.
 *
 * "create" is the K20 level — reach the screen, add a row, touch nothing that
 * exists. The negative half is the half worth pinning: a grant that drifted
 * up to "write" would hand her every edit and cancel on the order desk's POs.
 */
describe("the planner and purchase orders (P5)", () => {
  it("PLANNER may read and create a PO, and not write one", () => {
    expect(can("PLANNER", "purchase_order", "read")).toBe(true);
    expect(can("PLANNER", "purchase_order", "create")).toBe(true);
    expect(can("PLANNER", "purchase_order", "write")).toBe(false);
  });

  it("the order desk keeps full write; the owner stays read-only", () => {
    expect(can("ORDER_DESK", "purchase_order", "write")).toBe(true);
    expect(can("OWNER", "purchase_order", "read")).toBe(true);
    expect(can("OWNER", "purchase_order", "create")).toBe(false);
  });
});
