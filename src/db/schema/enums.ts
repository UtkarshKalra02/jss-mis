import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every fixed-value list in the system.
 *
 * These are Postgres enums, so the database rejects an invalid value rather
 * than trusting the application to have checked — and Drizzle derives the
 * TypeScript union from them, satisfying non-negotiable 5 (no enum values
 * hardcoded in components).
 *
 * The deliberate exception is STAGE. Stages are ADMIN-editable configuration
 * and live in the `stage` table, not here. Anything that varies by factory
 * process belongs in data; anything that varies only by code change belongs
 * here.
 *
 * Adding a value later requires a migration (ALTER TYPE ... ADD VALUE). That
 * friction is intentional: these lists are business-stable, and a new order
 * status is a decision, not a typo.
 */

export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "ORDER_DESK",
  "PLANNER",
  "ACCOUNTS",
  "FLOOR",
  "OWNER",
]);

/** Descriptive only — see jobTypeEnum for what actually drives stage flow. */
export const clientTypeEnum = pgEnum("client_type", ["New", "Repeat"]);

/**
 * Whether a PO item is a new job or a repeat run.
 *
 * This, not the client's type, decides which stages apply. A long-standing
 * repeat client still places genuinely new jobs, and those jobs do need
 * ENQUIRY and COSTING. (Spec section 4.1 was ambiguous here; resolved in
 * docs/DECISIONS.md B4.)
 */
export const jobTypeEnum = pgEnum("job_type", ["New", "Repeat"]);

/** stage.applies_to — describes the JOB, not the client. */
export const stageAppliesToEnum = pgEnum("stage_applies_to", [
  "All",
  "New",
  "Repeat",
]);

export const enquiryStatusEnum = pgEnum("enquiry_status", [
  "Open",
  "Quoted",
  "Won",
  "Lost",
]);

export const quotationStatusEnum = pgEnum("quotation_status", [
  "Sent",
  "Accepted",
  "Rejected",
  "Expired",
]);

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "Open",
  "Partially Dispatched",
  "Closed",
  "Cancelled",
]);

export const poItemStatusEnum = pgEnum("po_item_status", [
  "Open",
  "Closed",
  "Cancelled",
]);

export const priorityEnum = pgEnum("priority", ["Normal", "High", "Urgent"]);

/**
 * How committed_date was arrived at. 'Manual' is the only value used in v1;
 * 'Calculated' is reserved for when scheduling can derive it. Modelled as an
 * enum rather than the spec's free text so the v2 migration is a schema change
 * with a compiler error attached, not a silent string mismatch.
 */
export const committedDateBasisEnum = pgEnum("committed_date_basis", [
  "Manual",
  "Calculated",
]);

/**
 * NO LONGER USED BY ANY COLUMN, and kept on purpose.
 *
 * design.die_status and plate_status were dropped in migration 0016 when the
 * tooling register took over (I7). The Postgres TYPE still exists — dropping a
 * column does not drop the type it used — so this declaration stays to keep
 * drizzle-kit from emitting a DROP TYPE as a side effect of tidying.
 *
 * Removing the type is a separate, deliberate migration if it is ever worth
 * doing. It costs nothing where it is.
 */
export const dieplateStatusEnum = pgEnum("dieplate_status", [
  "Pending",
  "Ordered",
  "Received",
  "Old",
  "NA",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "Pending",
  "Approved",
  "Rejected",
]);

export const jobCardStatusEnum = pgEnum("job_card_status", [
  "Planned",
  "In Process",
  "On Hold",
  "Completed",
  "Cancelled",
]);

/**
 * Who provides the paper, and who provides the plate.
 *
 * 'Party' means the client sent it in. The distinction is on the paper job
 * card because it changes what the floor is waiting for: a job whose paper the
 * party is supplying cannot start until it arrives, and nobody on the press
 * can tell that from the item name.
 */
export const supplyByEnum = pgEnum("supply_by", ["Press", "Party"]);

/**
 * Where a fabrication option's VALUE is decided.
 *
 * Not where the option is chosen — that is always the design. This says who
 * answers the question the option asks. Matt-or-gloss belongs to the design and
 * is reused every order; new-die-or-old belongs to the run, because the design
 * does not change between orders and the die stops being new after the first.
 * 'None' is a plain tick with no question attached.
 */
export const fabricationScopeEnum = pgEnum("fabrication_scope", ["Design", "Run", "None"]);

/**
 * How paper is counted when it is bought and issued.
 *
 * The floor does not order 500 sheets, it orders a ream. These are the three
 * bundles the godown actually deals in, and each is a FIXED number of sheets —
 * Packet 100, Ream 500, Gross 144 — which is why this is an enum and not free
 * text with a number beside it.
 *
 * The multipliers live in `src/modules/job-cards/paper.ts`, typed against these
 * values so a fourth bundle cannot be added here without one.
 *
 * This replaced `sheets_per_ream` on both `job_card` and `press_run` (J18).
 * Two fields that each claimed to say how many sheets are in a ream could
 * disagree, and the wrong one would always be whichever nobody updated.
 */
export const paperBundleEnum = pgEnum("paper_bundle", ["Packet", "Ream", "Gross"]);

export const dispatchStatusEnum = pgEnum("dispatch_status", [
  "Draft",
  "Dispatched",
  "Cancelled",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "Draft",
  "Raised",
  "Partially Paid",
  "Paid",
  "Cancelled",
]);

export const receiptModeEnum = pgEnum("receipt_mode", [
  "NEFT",
  "RTGS",
  "Cheque",
  "Cash",
  "UPI",
  "Other",
]);

/* -------------------------------------------------------------------------- */
/* Tooling                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The four kinds of physical tooling the factory owns.
 *
 * ONE table with a discriminator rather than four near-identical tables
 * (decision I1): every question anybody actually asks — "where is it", "what
 * condition is it in", "what replaced it" — is the same question for all four,
 * and four tables would mean four screens, four queries and four places to
 * forget a filter.
 */
export const toolTypeEnum = pgEnum("tool_type", [
  "PLATE",
  "FOIL_BLOCK",
  "DIE",
  "EMBOSS_BLOCK",
]);

/** What state the metal is in. Distinct from where it is — see toolStatusEnum. */
export const toolConditionEnum = pgEnum("tool_condition", [
  "Good",
  "Worn",
  "Damaged",
  "Scrapped",
]);

/**
 * Where the tooling is, as a state rather than a location string.
 *
 * Set MANUALLY. There is deliberately no issue/return workflow (I5): a checkout
 * system is a daily-discipline burden nobody has agreed to carry, and one that
 * is half-kept is worse than none because it looks authoritative.
 */
export const toolStatusEnum = pgEnum("tool_status", [
  /**
   * Ordered from a vendor and not yet in the building.
   *
   * RECEIVING A TOOL IS AN EDIT, NOT A NEW RECORD (I11). Punit creates the row
   * when the die is ordered — vendor filled, location genuinely unknown — and
   * edits the SAME row to In House when it arrives. A second record would give
   * one physical die two numbers, and the number is written on the metal.
   *
   * First in the list because it comes first in a tool's life, and enum order
   * is what an ORDER BY status would follow.
   */
  "Ordered",
  "In House",
  "With Vendor",
  "Issued to Floor",
  "Lost",
]);

/**
 * How far a task has been delegated, from the BMP week 12 ladder.
 *
 * L2 "do it and report back", L3 "recommend, then act", L4 "act, report
 * routinely". Recorded on the task rather than on the person, because the same
 * person is delegated to at different levels depending on the work.
 */
export const delegationLevelEnum = pgEnum("delegation_level", ["L2", "L3", "L4"]);

/**
 * A delegated task's state.
 *
 * 'Cancelled' is deliberately NOT reachable by the person the task is assigned
 * to (decision G3). Cancelling is not progress on a task, it is withdrawal of
 * the task — and if the assignee could do it, cancelling the ones they were
 * about to miss would be the easiest way to score 100%.
 */
export const delegationStatusEnum = pgEnum("delegation_status", [
  "Not Started",
  "In Progress",
  "Done",
  "Blocked",
  "Cancelled",
]);

/**
 * Audit actions. There is no HARD_DELETE and there never will be —
 * non-negotiable 7.
 */
export const auditActionEnum = pgEnum("audit_action", [
  "INSERT",
  "UPDATE",
  "SOFT_DELETE",
  "RESTORE",
]);
