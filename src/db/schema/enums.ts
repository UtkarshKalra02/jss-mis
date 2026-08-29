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
