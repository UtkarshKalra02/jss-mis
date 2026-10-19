import { describe, expect, it } from "vitest";

import { ACCESS, RESOURCES, allowedResources, can, type Resource, type Role } from "@/auth/roles";

/**
 * DATA_ENTRY_FULL — "admin but not admin" (S4).
 *
 * The role is DEFINED BY WHAT IT WITHHOLDS, so that is what is asserted. A
 * test that only listed what it can reach would still pass on the day somebody
 * adds `admin` to it, which is the single change that would make the role
 * pointless.
 */
describe("DATA_ENTRY_FULL", () => {
  /** Everything ADMIN reaches, which is every resource there is. */
  const everything = RESOURCES;

  it("cannot administer: no users, no stage config, no app settings", () => {
    expect(can("DATA_ENTRY_FULL", "admin")).toBe(false);
    // Not even read. There is no read-only Admin screen to grant.
    expect(ACCESS.DATA_ENTRY_FULL.admin).toBeUndefined();
  });

  it("withholds exactly the resources S4 names, and no others", () => {
    const withheld = everything.filter((r) => !can("DATA_ENTRY_FULL", r));
    expect([...withheld].sort()).toEqual(
      [
        "admin",
        "ar_ledger",
        "delegation_scorecard",
        "invoice",
        "receipt",
      ].sort(),
    );
  });

  it("writes everything the factory enters", () => {
    const writes: Resource[] = [
      "enquiry",
      "quotation",
      "purchase_order",
      "design",
      "client",
      "tooling",
      "job_planning",
      "job_card",
      "press_run",
      "stage_update",
      "dispatch",
      "import",
      "material",
      "delegation",
    ];
    for (const r of writes) expect(can("DATA_ENTRY_FULL", r, "write")).toBe(true);
  });

  it("reads, but does not write, the tracker and the reports", () => {
    for (const r of ["item_tracker", "reports", "dashboard"] as Resource[]) {
      expect(can("DATA_ENTRY_FULL", r)).toBe(true);
      expect(can("DATA_ENTRY_FULL", r, "write")).toBe(false);
    }
  });

  it("is not the store's DATA_ENTRY, which stays narrow (O5)", () => {
    expect(allowedResources("DATA_ENTRY").sort()).toEqual(["dashboard", "material"]);
    expect(allowedResources("DATA_ENTRY_FULL").length).toBeGreaterThan(10);
  });
});


/**
 * Who may raise a card for work whose PO has not arrived (U1).
 *
 * The bug this guards against was not a missing grant but a MISMATCH: the
 * /items/new page demanded "write" while the action behind it, and its own
 * sibling that captures a full PO, needed only "create". The people who raise
 * job cards could not reach it, so a manual card took two people. Asserted as
 * a pair — card AND item — because either alone was already true and neither
 * alone was the problem.
 */
describe("raising a job card before the PO arrives", () => {
  const bothEnds: Role[] = ["ADMIN", "PLANNER", "ACCOUNTS", "DATA_ENTRY_FULL"];

  it.each(bothEnds)("%s can both add the item and raise the card", (role) => {
    expect(can(role, "purchase_order", "create")).toBe(true);
    expect(can(role, "job_card", "write")).toBe(true);
  });

  it("still does not let them rewrite an order that exists", () => {
    // "create" is the P5 level: record one, never edit, cancel or remove one.
    for (const role of ["PLANNER", "ACCOUNTS"] as Role[]) {
      expect(can(role, "purchase_order", "write")).toBe(false);
    }
  });

  it("does not hand the order desk a job card to go with it", () => {
    // Punit captures orders and reads the cards raised against his designs
    // (J14). Widening the other side was never part of this.
    expect(can("ORDER_DESK", "job_card", "write")).toBe(false);
  });
});
