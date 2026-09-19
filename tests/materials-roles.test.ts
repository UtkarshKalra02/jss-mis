import { describe, expect, it } from "vitest";

import { allowedResources, can, LANDING_ROUTE, ROLES } from "@/auth/roles";

/**
 * Decision O5: who may touch the store.
 *
 * DATA_ENTRY is a role that can reach the store and nothing else. That is the
 * whole of its design, so the negative half is the half worth pinning.
 */
describe("the store's access (O5)", () => {
  it("ADMIN, PLANNER and DATA_ENTRY write; OWNER reads; nobody else sees it", () => {
    expect(can("ADMIN", "material", "write")).toBe(true);
    expect(can("PLANNER", "material", "write")).toBe(true);
    expect(can("DATA_ENTRY", "material", "write")).toBe(true);
    expect(can("OWNER", "material", "read")).toBe(true);
    expect(can("OWNER", "material", "write")).toBe(false);
    expect(can("ORDER_DESK", "material")).toBe(false);
    expect(can("ACCOUNTS", "material")).toBe(false);
    expect(can("FLOOR", "material")).toBe(false);
  });

  it("DATA_ENTRY reaches the store and the dashboard, and nothing else", () => {
    expect(allowedResources("DATA_ENTRY").sort()).toEqual(["dashboard", "material"]);
    expect(can("DATA_ENTRY", "purchase_order")).toBe(false);
    expect(can("DATA_ENTRY", "job_card")).toBe(false);
    expect(can("DATA_ENTRY", "ar_ledger")).toBe(false);
    expect(can("DATA_ENTRY", "admin")).toBe(false);
  });

  it("lands DATA_ENTRY on the store", () => {
    expect(LANDING_ROUTE.DATA_ENTRY).toBe("/materials");
  });

  it("every role has a landing route", () => {
    for (const role of ROLES) expect(LANDING_ROUTE[role]).toMatch(/^\//);
  });
});
