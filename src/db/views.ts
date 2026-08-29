import { boolean, date, integer, numeric, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";

import {
  clientTypeEnum,
  delegationLevelEnum,
  delegationStatusEnum,
  invoiceStatusEnum,
  jobTypeEnum,
  poItemStatusEnum,
  priorityEnum,
} from "./schema/enums";

/**
 * The derived views, described to TypeScript.
 *
 * Six of them are spec section 5. The last two belong to the Delegation module
 * (BMP week 9), which is not in the v1 spec at all — see section G of
 * DECISIONS.md.
 *
 * Every one is declared `.existing()`, which tells drizzle-kit that something
 * else owns the definition — in this case the hand-written migrations 0002 and
 * 0006. Nothing here creates, alters or drops a view. If you change what a view
 * SELECTS, you change the SQL in a migration; this file only describes the
 * shape so queries against it are typed.
 *
 * WHY THIS FILE IS NOT IN src/db/schema/index.ts. That barrel is what
 * drizzle-kit reads to discover the schema, and views are deliberately outside
 * its remit. Keeping them out means there is no path by which a future
 * `db:generate` decides it should manage them and emits a DROP VIEW. Queries do
 * not need the barrel: `db.select().from(vPoItemStatus)` works because the
 * view object carries its own definition.
 *
 * WHY THEY ARE TYPED AT ALL. Until now these views existed only in Postgres,
 * reachable from psql and from nothing else. A screen author who cannot select
 * from `v_po_item_status` in TypeScript will reconstruct pending_qty in a
 * query instead, and the moment two definitions of pending_qty exist, one of
 * them is wrong (non-negotiable 2).
 *
 * All six are described even though Phase 2 only reads the first, on the same
 * reasoning as decision C9: half-exposed is the state most likely to make
 * somebody write the raw query.
 *
 * NULLABILITY. `.notNull()` is claimed only where the SQL actually guarantees
 * it — a column from an inner join, a COALESCE, or an expression that cannot
 * evaluate to null. is_overdue and is_at_risk are notNull because migration
 * 0006 made them so on purpose: a null there would disappear from both
 * `WHERE flag` and `WHERE NOT flag`.
 */

/* -------------------------------------------------------------------------- */
/* v_po_item_status — the spine view                                           */
/* -------------------------------------------------------------------------- */

/**
 * One row per live PO item, with quantities, derived stage, and risk flags.
 *
 * This is where non-negotiables 1 and 2 are implemented. current_stage and
 * pending_qty are computed here and stored nowhere, so the app, a report and a
 * psql session all get the same answer.
 */
export const vPoItemStatus = pgView("v_po_item_status", {
  poItemId: uuid("po_item_id").notNull(),
  itemCode: text("item_code").notNull(),
  itemName: text("item_name").notNull(),

  purchaseOrderId: uuid("purchase_order_id").notNull(),
  poInternalNo: text("po_internal_no").notNull(),
  /** The client's own PO number, as printed on their document. Often absent. */
  clientPoNo: text("client_po_no"),
  poDate: date("po_date").notNull(),

  clientId: uuid("client_id").notNull(),
  clientCode: text("client_code").notNull(),
  clientName: text("client_name").notNull(),

  designId: uuid("design_id"),
  jobType: jobTypeEnum("job_type").notNull(),
  priority: priorityEnum("priority").notNull(),
  status: poItemStatusEnum("status").notNull(),

  orderedQty: integer("ordered_qty").notNull(),
  /** COALESCEd to 0, so an item with no challans reads 0 rather than null. */
  dispatchedQty: integer("dispatched_qty").notNull(),
  /** NON-NEGOTIABLE 2. Computed, never stored. */
  pendingQty: integer("pending_qty").notNull(),
  lastDispatchDate: date("last_dispatch_date"),

  /** NON-NEGOTIABLE 1. Null until the item has its first stage event. */
  currentStage: text("current_stage"),
  currentStageName: text("current_stage_name"),
  /** Hex, from the stage table. Never hardcode a stage colour (non-neg. 5). */
  currentStageColour: text("current_stage_colour"),
  currentStageSequence: integer("current_stage_sequence"),
  currentStageSince: timestamp("current_stage_since", { withTimezone: true }),

  /**
   * Null ONLY for imported historical rows (F8). Screens must render null as
   * "Historical — no commitment recorded", not as a blank cell.
   */
  committedDate: date("committed_date"),
  /** Null whenever committedDate is. Negative means overdue. */
  daysToCommitted: integer("days_to_committed"),

  /** Never null — see the note above about three-valued logic. */
  isOverdue: boolean("is_overdue").notNull(),
  isAtRisk: boolean("is_at_risk").notNull(),
}).existing();

/* -------------------------------------------------------------------------- */
/* v_otd — one row per fully-dispatched item                                   */
/* -------------------------------------------------------------------------- */

/**
 * The headline number's source. Excludes items with no committed date
 * entirely (F8): an item nobody made a promise about is not a delivery
 * performance data point in either direction.
 */
export const vOtd = pgView("v_otd", {
  poItemId: uuid("po_item_id").notNull(),
  itemCode: text("item_code").notNull(),
  itemName: text("item_name").notNull(),

  clientId: uuid("client_id").notNull(),
  clientCode: text("client_code").notNull(),
  clientName: text("client_name").notNull(),

  poDate: date("po_date").notNull(),
  orderedQty: integer("ordered_qty").notNull(),
  committedDate: date("committed_date").notNull(),

  /** MAX(dispatch_date) across live challans — not the last row entered. */
  fulfilmentDate: date("fulfilment_date").notNull(),
  onTime: boolean("on_time").notNull(),
  /** Negative when delivered early. */
  daysLate: integer("days_late").notNull(),
  leadTimeDays: integer("lead_time_days").notNull(),
  fulfilmentMonth: date("fulfilment_month").notNull(),
}).existing();

/* -------------------------------------------------------------------------- */
/* v_wip_ageing — what has been sitting too long                               */
/* -------------------------------------------------------------------------- */

/**
 * The stage-overrun signal, which is NOT the dashboard's at-risk rule — see
 * decision B3 for why both exist.
 *
 * targetHoursVerified is carried through deliberately (A2). Any screen showing
 * isOverTarget must be able to say the threshold is an unverified placeholder,
 * because most of them still are.
 */
export const vWipAgeing = pgView("v_wip_ageing", {
  poItemId: uuid("po_item_id").notNull(),
  itemCode: text("item_code").notNull(),
  itemName: text("item_name").notNull(),
  clientCode: text("client_code").notNull(),
  clientName: text("client_name").notNull(),

  pendingQty: integer("pending_qty").notNull(),
  priority: priorityEnum("priority").notNull(),

  currentStage: text("current_stage").notNull(),
  currentStageName: text("current_stage_name"),
  currentStageColour: text("current_stage_colour"),
  currentStageSince: timestamp("current_stage_since", { withTimezone: true }).notNull(),

  hoursInStage: numeric("hours_in_stage").notNull(),
  /** Null when the stage has no target set. */
  targetHours: numeric("target_hours"),
  /** False on every seeded row until a human measures it (A2). */
  targetHoursVerified: boolean("target_hours_verified").notNull(),
  /** Null when there is no target to be over. */
  isOverTarget: boolean("is_over_target"),

  committedDate: date("committed_date"),
  daysToCommitted: integer("days_to_committed"),
  isOverdue: boolean("is_overdue").notNull(),
  isAtRisk: boolean("is_at_risk").notNull(),
}).existing();

/* -------------------------------------------------------------------------- */
/* v_ar_ageing — outstanding per invoice, bucketed (Phase 5)                    */
/* -------------------------------------------------------------------------- */

export const vArAgeing = pgView("v_ar_ageing", {
  invoiceId: uuid("invoice_id").notNull(),
  invoiceNo: text("invoice_no").notNull(),

  clientId: uuid("client_id").notNull(),
  clientCode: text("client_code").notNull(),
  clientName: text("client_name").notNull(),

  invoiceDate: date("invoice_date").notNull(),
  /** invoice_date + client.payment_terms_days, when it was set. */
  dueDate: date("due_date"),

  totalAmount: numeric("total_amount"),
  paidAmount: numeric("paid_amount").notNull(),
  outstanding: numeric("outstanding"),

  /** 0 rather than negative while still within terms. Null if no due date. */
  daysOverdue: integer("days_overdue"),
  /** 'Paid' | '0-30' | '31-60' | '61-90' | '90+' */
  ageingBucket: text("ageing_bucket").notNull(),

  status: invoiceStatusEnum("status").notNull(),
  busySynced: boolean("busy_synced").notNull(),
}).existing();

/* -------------------------------------------------------------------------- */
/* v_client_summary — one row per client (Phase 6)                             */
/* -------------------------------------------------------------------------- */

export const vClientSummary = pgView("v_client_summary", {
  clientId: uuid("client_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  clientType: clientTypeEnum("client_type").notNull(),
  isActive: boolean("is_active").notNull(),
  creditLimit: numeric("credit_limit"),

  orderValue: numeric("order_value").notNull(),
  itemCount: integer("item_count").notNull(),
  dispatchValue: numeric("dispatch_value").notNull(),

  totalOutstanding: numeric("total_outstanding").notNull(),
  overdueOutstanding: numeric("overdue_outstanding").notNull(),

  deliveredItems: integer("delivered_items").notNull(),
  /** Null until the client has at least one delivered item. */
  otdPct: numeric("otd_pct"),
}).existing();

/* -------------------------------------------------------------------------- */
/* v_enquiry_funnel — by month and client (Phase 6)                            */
/* -------------------------------------------------------------------------- */

export const vEnquiryFunnel = pgView("v_enquiry_funnel", {
  month: date("month").notNull(),
  clientId: uuid("client_id").notNull(),
  clientCode: text("client_code").notNull(),
  clientName: text("client_name").notNull(),

  enquiryCount: integer("enquiry_count").notNull(),
  /** Counts enquiries with a quotation ATTACHED, not ones marked 'Quoted'. */
  quotedCount: integer("quoted_count").notNull(),
  wonCount: integer("won_count").notNull(),
  lostCount: integer("lost_count").notNull(),
  openCount: integer("open_count").notNull(),

  /** Null when nothing has been quoted yet — not zero. */
  quoteToWinPct: numeric("quote_to_win_pct"),
}).existing();

/* -------------------------------------------------------------------------- */
/* v_delegation_status — one row per live delegated task                       */
/* -------------------------------------------------------------------------- */

/**
 * A delegated task with its lateness computed (migration 0012).
 *
 * days_late and is_overdue live here and nowhere else, on the same reasoning as
 * pending_qty (non-negotiable 2). "Late" has one definition, so the task list
 * and the meeting scorecard cannot disagree in front of everybody.
 */
export const vDelegationStatus = pgView("v_delegation_status", {
  delegationTaskId: uuid("delegation_task_id").notNull(),

  assignedTo: uuid("assigned_to").notNull(),
  assignedToName: text("assigned_to_name").notNull(),
  assignedToUsername: text("assigned_to_username").notNull(),
  assignedBy: uuid("assigned_by").notNull(),
  assignedByName: text("assigned_by_name").notNull(),

  task: text("task").notNull(),
  level: delegationLevelEnum("level").notNull(),
  dateGiven: date("date_given").notNull(),
  expectedDate: date("expected_date").notNull(),
  status: delegationStatusEnum("status").notNull(),
  completedAt: date("completed_at"),
  blockerNote: text("blocker_note"),

  /** Zero when on time, when cancelled, and when not yet due. Never negative. */
  daysLate: integer("days_late").notNull(),

  /**
   * Late right now AND still open. A task finished late is not overdue — it is
   * finished. notNull because a null boolean vanishes from both `WHERE flag`
   * and `WHERE NOT flag`, taking the row out of every filter at once.
   */
  isOverdue: boolean("is_overdue").notNull(),

  /** Negative until due, so "in 3 days" and "3 days late" are one number. */
  daysPastDue: integer("days_past_due").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).existing();

/* -------------------------------------------------------------------------- */
/* v_delegation_scorecard — the executive meeting screen                       */
/* -------------------------------------------------------------------------- */

/**
 * Per-person delegation performance (migration 0012).
 *
 * Built on v_delegation_status, not on the table, so there is one definition of
 * late. `assigned` excludes cancelled tasks, which is only safe because the
 * assignee cannot cancel their own (decision G3).
 */
export const vDelegationScorecard = pgView("v_delegation_scorecard", {
  appUserId: uuid("app_user_id").notNull(),
  name: text("name").notNull(),
  username: text("username").notNull(),

  /** Everything not cancelled. The denominator of the score. */
  assigned: integer("assigned").notNull(),
  done: integer("done").notNull(),
  onTime: integer("on_time").notNull(),
  late: integer("late").notNull(),
  open: integer("open").notNull(),
  overdueNow: integer("overdue_now").notNull(),

  /**
   * on_time / assigned, as a whole percent. NULL when there is nothing to
   * score — "no score yet" and "scored zero" are different statements, and on a
   * screen read aloud in a meeting the difference is somebody's reputation.
   */
  scorePct: integer("score_pct"),

  /** Average lateness of the tasks that were late. Zero when none were. */
  avgDaysLate: numeric("avg_days_late").notNull(),
}).existing();

export type PoItemStatusRow = typeof vPoItemStatus.$inferSelect;
export type OtdRow = typeof vOtd.$inferSelect;
export type WipAgeingRow = typeof vWipAgeing.$inferSelect;
export type ArAgeingRow = typeof vArAgeing.$inferSelect;
export type ClientSummaryRow = typeof vClientSummary.$inferSelect;
export type EnquiryFunnelRow = typeof vEnquiryFunnel.$inferSelect;
export type DelegationStatusRow = typeof vDelegationStatus.$inferSelect;
export type DelegationScorecardRow = typeof vDelegationScorecard.$inferSelect;
