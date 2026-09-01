/**
 * THE ROLE MATRIX.
 *
 * This is the single source of truth for who can see and do what. The sidebar
 * renders from it and the server-side guards enforce against it. Keeping one
 * copy is the whole point: two copies is exactly how a screen ends up hidden
 * from the nav but still reachable by typing the URL.
 *
 * Resolves the contradiction between spec section 2 (the role table) and
 * section 6 (the screen headers) in favour of section 6 — see decision B1:
 *   - FLOOR gets a read-only Item Tracker
 *   - ACCOUNTS gets Dispatch
 *   - OWNER gets read-only AR
 *   - Reports (no role stated in the spec) goes to ADMIN, OWNER, ACCOUNTS
 *
 * Client master access follows decision A3: ADMIN writes, the three desk roles
 * read, OWNER and FLOOR get nothing.
 *
 * OWNER is read-only EVERYWHERE (decision B2), with exactly one documented
 * exception: `delegation` (decision G2), so Amit can mark his own delegated
 * tasks done and therefore appear on the scorecard. That grant is what lets him
 * REACH the screen; what he may actually write is decided by the audit wrapper
 * and is much narrower than the grant — three columns, on rows assigned to him.
 *
 * Enforcement is not here in either case. The hard check is inside the audit
 * wrapper, so a future screen that forgets to call assertCan() still cannot let
 * an OWNER write.
 */

export const ROLES = [
  "ADMIN",
  "ORDER_DESK",
  "PLANNER",
  "ACCOUNTS",
  "FLOOR",
  "OWNER",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Resources are screens/domains, not tables. They are the unit a person would
 * describe access in: "Preeti does dispatch", not "Preeti can update
 * dispatch_line".
 */
export const RESOURCES = [
  "dashboard",
  "enquiry",
  "quotation",
  "purchase_order",
  "design",
  "tooling",
  "item_tracker",
  "job_planning",
  "press_run",
  "stage_update",
  "dispatch",
  "invoice",
  "receipt",
  "ar_ledger",
  "reports",
  "client",
  "import",
  "delegation",
  "delegation_scorecard",
  "admin",
] as const;

export type Resource = (typeof RESOURCES)[number];

/** "write" implies "read". Absent means no access at all. */
export type Access = "read" | "write";

type Matrix = Record<Role, Partial<Record<Resource, Access>>>;

export const ACCESS: Matrix = {
  ADMIN: {
    dashboard: "write",
    enquiry: "write",
    quotation: "write",
    purchase_order: "write",
    design: "write",
    tooling: "write",
    item_tracker: "write",
    job_planning: "write",
    press_run: "write",
    stage_update: "write",
    dispatch: "write",
    invoice: "write",
    receipt: "write",
    ar_ledger: "write",
    reports: "write",
    client: "write",
    import: "write",
    delegation: "write",
    delegation_scorecard: "read",
    admin: "write",
  },

  ORDER_DESK: {
    dashboard: "read",
    enquiry: "write",
    quotation: "write",
    purchase_order: "write",
    design: "write",

    /**
     * Punit owns the tooling register (I9). It is the only thing outside the
     * order desk's own paperwork that he creates and edits, and it is his
     * because he is the one who knows what a die is called and where it lives.
     */
    tooling: "write",

    item_tracker: "read",
    // Read only: the ganged badge on the Item Tracker links to the run, so
    // anybody who can see an item can see the run it was printed in (H6).
    press_run: "read",
    client: "read", // A3 — cannot enter a PO without picking a client

    /**
     * F28. The importer writes purchase orders AND dispatches, so granting it
     * to ORDER_DESK is a deliberate widening: Punit cannot reach the Dispatch
     * screen, but can create dispatch rows through a bulk import. That is what
     * the requirement asks for — "later batch catch-up by a data-entry person"
     * — and the importer is a far more constrained instrument than the dispatch
     * screen: it only ever records deliveries that already happened, every row
     * is previewed before anything is written, and a whole batch can be undone
     * in one action.
     */
    import: "write",

    /** Everyone owns tasks, so everyone gets the screen (G1). */
    delegation: "write",
  },

  PLANNER: {
    dashboard: "read",
    job_planning: "write",
    press_run: "write",
    stage_update: "write",
    dispatch: "write",
    item_tracker: "read",
    tooling: "read",
    client: "read",
    delegation: "write",
  },

  ACCOUNTS: {
    dashboard: "read",
    invoice: "write",
    receipt: "write",
    ar_ledger: "write",
    dispatch: "write", // B1 — section 6.8 lists ACCOUNTS
    reports: "read", // B1
    item_tracker: "read",
    press_run: "read",
    tooling: "read",
    client: "read",
    delegation: "write",
  },

  /**
   * Ajay, on a phone. Section 2 says "Stage Update only"; section 6.4 says the
   * Item Tracker is for everyone. Both are honoured: he can update stages and
   * look things up, and has no dashboard — his landing page IS Stage Update,
   * which is also the better phone experience than a dashboard he cannot act
   * on.
   */
  FLOOR: {
    stage_update: "write",
    item_tracker: "read",
    press_run: "read",

    /**
     * Ajay gets the tooling register READ-ONLY, on a phone. Looking up which
     * rack a die is kept in, while standing next to the racks, is exactly the
     * mobile case — and it is the one screen outside Stage Update he has a
     * daily reason to open (I9).
     */
    tooling: "read",

    delegation: "write",
  },

  /**
   * Amit. Read-only everywhere, by design (B2) — with ONE exception.
   *
   * `delegation: "write"` is the only "write" any OWNER has ever had in this
   * matrix, and it is deliberately here rather than hidden: the matrix should
   * describe what is true. What it does NOT mean is that an OWNER can write
   * delegation tasks generally. The real boundary is enforced in the audit
   * wrapper (decision G2) and is far narrower than this grant — his own task's
   * status, completion date and blocker note, nothing else, on rows already
   * assigned to him. He cannot delegate, cancel, reassign, or change a date.
   *
   * This entry exists so he can reach My Tasks. The wrapper is what decides
   * what he can do once he is there.
   */
  OWNER: {
    dashboard: "read",
    item_tracker: "read",
    ar_ledger: "read", // B1 — section 6.10 lists OWNER
    reports: "read", // B1
    press_run: "read",
    tooling: "read",
    delegation: "write", // G2
    delegation_scorecard: "read",
  },
};

/** Human-readable role names, and what each one is for. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  ORDER_DESK: "Order Desk",
  PLANNER: "Planner",
  ACCOUNTS: "Accounts",
  FLOOR: "Floor",
  OWNER: "Owner",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Everything, including users and configuration.",
  ORDER_DESK: "Enquiries, quotations, POs and designs.",
  PLANNER: "Job planning, stage updates and dispatch.",
  ACCOUNTS: "Invoices, receipts, AR ledger and dispatch.",
  FLOOR: "Stage updates only, on a phone.",
  OWNER: "Read-only across dashboard, tracker, AR and reports.",
};

/** Where each role lands after logging in. */
export const LANDING_ROUTE: Record<Role, string> = {
  ADMIN: "/dashboard",
  ORDER_DESK: "/dashboard",
  PLANNER: "/dashboard",
  ACCOUNTS: "/dashboard",
  FLOOR: "/stage-update",
  OWNER: "/dashboard",
};

export function can(role: Role, resource: Resource, access: Access = "read"): boolean {
  const granted = ACCESS[role]?.[resource];
  if (!granted) return false;
  return access === "read" ? true : granted === "write";
}

/** Thrown by assertCan. Caught at the route boundary and rendered as 403. */
export class ForbiddenError extends Error {
  constructor(
    readonly role: Role,
    readonly resource: Resource,
    readonly access: Access,
  ) {
    super(`${role} is not allowed to ${access} ${resource}.`);
    this.name = "ForbiddenError";
  }
}

/**
 * Guard for server actions and route handlers. Throws rather than returning a
 * boolean, so forgetting to check the result is not a silent failure.
 */
export function assertCan(role: Role, resource: Resource, access: Access = "read"): void {
  if (!can(role, resource, access)) throw new ForbiddenError(role, resource, access);
}

/** Every resource a role can reach, in RESOURCES order. Used by the sidebar. */
export function allowedResources(role: Role): Resource[] {
  return RESOURCES.filter((r) => can(role, r));
}
