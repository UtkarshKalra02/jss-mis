import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns, MONEY } from "./_shared";
import {
  approvalStatusEnum,
  committedDateBasisEnum,
  confirmationSourceEnum,
  jobTypeEnum,
  poItemStatusEnum,
  priorityEnum,
  purchaseOrderStatusEnum,
} from "./enums";
import { importBatch } from "./imports";
import { material } from "./materials";
import { enquiry } from "./pre-order";
import { client } from "./reference";
import { appUser } from "./users";

/* -------------------------------------------------------------------------- */
/* design                                                                      */
/* -------------------------------------------------------------------------- */

/** A reusable lookup, not a tracked entity — spec section 3. */
export const design = pgTable(
  "design",
  {
    ...baseColumns(),

    /** DSN-NNNNN. Not year-scoped: a design outlives any financial year. */
    designCode: text().notNull(),

    clientId: uuid()
      .notNull()
      .references(() => client.id),

    jobName: text().notNull(),
    jobSize: text(),
    gsm: text(),
    paperType: text(),
    printType: text(),
    noOfColours: text(),

    /**
     * The paper this design usually prints on, from the stock master (O6).
     *
     * `gsm` and `paper_type` above are the older free text. When a material is
     * linked the screens show the master's values instead; the columns stay
     * for designs that predate the master, and dropping them is a deploy-first
     * migration for later (BACKLOG). The job card's paper picker defaults to
     * this.
     */
    materialId: uuid().references(() => material.id),

    /*
     * die_id, plate_id, die_status and plate_status USED TO LIVE HERE, as free
     * text, and were dropped in migration 0016 (decision I7).
     *
     * Once the tooling register existed they were a second source of truth for
     * "does this design have a die, and where is it" — and the wrong one would
     * always have been whichever nobody updated that week. The design screen
     * now shows the tooling attached to it, derived from the register, so
     * there is one place to change a location and one place to read it.
     */

    approvalStatus: approvalStatusEnum().notNull().default("Pending"),
    approvedAt: timestamp({ withTimezone: true }),
    approvedBy: uuid().references(() => appUser.id),

    artworkUrl: text(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("design_code_key")
      .on(t.designCode)
      .where(sql`${t.deletedAt} is null`),
    index("design_client_idx").on(t.clientId),
    index("design_job_name_idx").on(t.jobName),
    index("design_material_idx").on(t.materialId),

    // An approval without a timestamp and an approver is not an approval.
    check(
      "design_approval_complete",
      sql`${t.approvalStatus} <> 'Approved' or (${t.approvedAt} is not null and ${t.approvedBy} is not null)`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* purchase_order                                                              */
/* -------------------------------------------------------------------------- */

export const purchaseOrder = pgTable(
  "purchase_order",
  {
    ...baseColumns(),

    /** The client's own PO number, as printed on their document. */
    poNo: text(),

    /** Ours: PO-YYYY-NNNN, financial year. */
    internalNo: text().notNull(),

    clientId: uuid()
      .notNull()
      .references(() => client.id),

    poDate: date().notNull(),

    /** Set when this PO was converted from a won enquiry. */
    enquiryId: uuid().references(() => enquiry.id),

    /** Scanned PO. Storage backend deferred; see docs/DECISIONS.md D. */
    fileUrl: text(),

    /**
     * Set when this row came from the historical importer rather than from a
     * person at the PO capture screen. Null for everything typed by hand.
     * Undoing a batch soft-deletes exactly the rows carrying its id.
     */
    importBatchId: uuid().references(() => importBatch.id),

    /**
     * DERIVED, but stored (decision B5). Recomputed on write and nightly from
     * the item rows underneath it. Only the recompute function and the
     * explicit Cancel action may write this column — never a form. It is a
     * column rather than a view because it is filtered and indexed constantly,
     * and because 'Cancelled' is a human decision that cannot be derived from
     * dispatch quantities.
     */
    status: purchaseOrderStatusEnum().notNull().default("Open"),

    /**
     * Job work: the client sent their own material and asked for a process
     * (section Z). No PO is coming, ever.
     *
     * WHY THIS EXISTS AND IS NOT JUST A LABEL. `po_awaited` means "no PO
     * number, and a person typed this rather than importing it" (N1) — a
     * prompt to go and get the document. For job work there is no document, so
     * without this flag a job-work order would sit in the Item Tracker asking
     * for one permanently. v_po_item_status reads it in the po_awaited
     * expression itself, so no screen has to remember the special case.
     *
     * ON THE ORDER, NOT THE ITEM. Job work is a fact about the arrangement
     * with the client, not about one carton — and po_awaited is computed from
     * this table, so both are decided by one row.
     *
     * NOT NULL DEFAULT false, unlike `ups` (section Y) and the confirmation
     * columns (W1) which are nullable. Those record something never observed
     * about existing rows, where a default would invent data. This default is
     * a fact: no order has ever been job work, because nobody could say so.
     *
     * It says nothing about money. Busy remains the book of record (SOP brief
     * rule 5); this is only "no PO is coming".
     */
    isJobWork: boolean().notNull().default(false),

    notes: text(),
  },
  (t) => [
    uniqueIndex("purchase_order_internal_no_key")
      .on(t.internalNo)
      .where(sql`${t.deletedAt} is null`),
    index("purchase_order_client_idx").on(t.clientId),
    index("purchase_order_status_idx").on(t.status),
    index("purchase_order_date_idx").on(t.poDate),
  ],
);

/* -------------------------------------------------------------------------- */
/* po_item — THE SPINE                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Everything in this system hangs off po_item. Stage events, job cards,
 * dispatch lines, and ultimately OTD all reference it.
 *
 * Note what is NOT here: dispatched_qty, pending_qty, and current_stage.
 * Those are derived in v_po_item_status (non-negotiables 1 and 2). If you ever
 * find yourself wanting to add one of them as a column to make a query
 * simpler, that is the moment the data starts lying.
 */
export const poItem = pgTable(
  "po_item",
  {
    ...baseColumns(),

    /** ITM-YYYY-NNNNN, financial year. */
    itemCode: text().notNull(),

    purchaseOrderId: uuid()
      .notNull()
      .references(() => purchaseOrder.id),

    designId: uuid().references(() => design.id),

    itemName: text().notNull(),
    orderedQty: integer().notNull(),
    rate: numeric(MONEY),

    /**
     * THE SINGLE MOST IMPORTANT FIELD (spec section 4.3, non-negotiable 6).
     * OTD is measured against it, and there is no default — a guessed
     * commitment is worse than none.
     *
     * NULLABLE FOR EXACTLY ONE REASON (decision F8): a historical job copied
     * out of a paper book genuinely has no commitment recorded against it.
     * Writing an invented date would be worse than writing none, because an
     * invented date is indistinguishable from a real one and would quietly
     * become part of OTD.
     *
     * The rules that make that safe, all of which hold together:
     *
     *   - The PO capture form requires it. Always, no skip.
     *   - The importer is the only path permitted to write null.
     *   - v_otd EXCLUDES these rows. Never counted as met, never as missed —
     *     an item with no commitment cannot be late.
     *   - v_po_item_status reports is_overdue and is_at_risk as FALSE for
     *     them, not null, so no filter accidentally sweeps them up.
     *   - Screens render them as "Historical — no commitment recorded", never
     *     as a blank cell. A blank reads as data somebody should go and fill
     *     in; the whole point is that there is nothing to fill in.
     *
     * If you are adding a new entry point, it requires a committed date.
     */
    committedDate: date(),
    committedDateBasis: committedDateBasisEnum().notNull().default("Manual"),

    /** Decides which stages apply. See jobTypeEnum. */
    jobType: jobTypeEnum().notNull().default("New"),

    priority: priorityEnum().notNull().default("Normal"),

    /** Derived but stored, same rules as purchase_order.status. */
    status: poItemStatusEnum().notNull().default("Open"),

    remarks: text(),

    /** See purchase_order.import_batch_id. */
    importBatchId: uuid().references(() => importBatch.id),

    /* ---------------------------------------------------------------- */
    /* Job opening discipline — SOP Rule 1 (section W, migration 0047)  */
    /* ---------------------------------------------------------------- */

    /**
     * HOW the customer confirmed this order, WHO at JSS took the
     * confirmation, and WHEN. Together they answer the only question SOP
     * Rule 1 can actually be measured by: how long after a customer said
     * yes did we open the job? v_job_opening does that arithmetic against
     * created_at, in working minutes.
     *
     * ALL THREE OR NONE — enforced by po_item_confirmation_all_or_none,
     * written with explicit IS NOT NULL on every term because a CHECK that
     * evaluates to NULL passes (the 0046 lesson).
     *
     * NULLABLE FOR THE SAME REASON AS committed_date (F8): every row that
     * predates this, and every row the importer writes, genuinely has no
     * confirmation recorded. An invented one would be indistinguishable
     * from a real one and would quietly become part of the metric.
     * v_job_opening reports NULL — never false — for those rows, so a
     * filter on "opened late" cannot sweep up the whole history.
     *
     * The PO capture form requires all three. The importer is the only path
     * permitted to leave them null. If you add another entry point, it
     * requires them.
     *
     * There is deliberately NO opened_at column: it would duplicate
     * created_at exactly. v_job_opening exposes created_at AS opened_at.
     */
    confirmationSource: confirmationSourceEnum(),
    confirmedBy: uuid().references(() => appUser.id),
    confirmedAt: timestamp({ withTimezone: true }),

    /* ---------------------------------------------------------------- */
    /* Manual job close — section X, migration 0048                     */
    /* ---------------------------------------------------------------- */

    /**
     * A person decided this job is over although it was never fully
     * delivered: WHEN they decided, WHO decided, and WHY.
     *
     * CLOSED IS NOT CANCELLED. Cancelled means the order went away and
     * never happened. This means we delivered what we were going to
     * deliver and the shortfall is written off — the job happened, short.
     *
     * THESE COLUMNS ARE WHAT MAKES THE CLOSE SURVIVE.
     * recompute_po_item_status() derives status from dispatch quantities on
     * every dispatch edit and again nightly; it returns early for
     * 'Cancelled' and for nothing else. A status set to 'Closed' by hand
     * while pending_qty > 0 would be recomputed back to 'Open' overnight.
     * So the close is stored as a FACT here and the recompute reads it —
     * which keeps status derived (B5) rather than stored, exactly as
     * 'Cancelled' always has.
     *
     * ALL THREE OR NONE, and the reason non-blank. Written with explicit
     * IS NULL / IS NOT NULL on every term because a CHECK that evaluates
     * to NULL passes (the 0046 lesson).
     *
     * WHO MAY SET THEM: ADMIN, DATA_ENTRY_FULL and OWNER. The OWNER grant
     * is the FOURTH documented exception to B2 and lives in src/db/audit.ts
     * with the other three — see the note there.
     *
     * WHEN THEY MAY: not until manual_close_min_days_after_po days after
     * the PO date (default 30). Enforced by a trigger, so a script gets the
     * same refusal a form does.
     */
    closedManuallyAt: timestamp({ withTimezone: true }),
    closedBy: uuid().references(() => appUser.id),
    closeReason: text(),
  },
  (t) => [
    uniqueIndex("po_item_code_key")
      .on(t.itemCode)
      .where(sql`${t.deletedAt} is null`),
    index("po_item_purchase_order_idx").on(t.purchaseOrderId),
    index("po_item_design_idx").on(t.designId),
    index("po_item_committed_date_idx").on(t.committedDate),
    index("po_item_status_idx").on(t.status),
    index("po_item_confirmed_at_idx").on(t.confirmedAt),
    index("po_item_closed_manually_at_idx").on(t.closedManuallyAt),

    check("po_item_ordered_qty_positive", sql`${t.orderedQty} > 0`),

    /**
     * All three confirmation columns together, or none of them. Every term
     * spelled out with IS NULL / IS NOT NULL: a bare AND chain would
     * evaluate to NULL when one column was missing, and a CHECK that
     * evaluates to NULL PASSES. That is exactly how 0045 shipped a
     * constraint that accepted "5 bundles of nothing".
     */
    check(
      "po_item_confirmation_all_or_none",
      sql`(${t.confirmationSource} IS NULL AND ${t.confirmedBy} IS NULL AND ${t.confirmedAt} IS NULL)
          OR (${t.confirmationSource} IS NOT NULL AND ${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`,
    ),

    /** The same all-or-none shape for the manual close (0048). */
    check(
      "po_item_manual_close_all_or_none",
      sql`(${t.closedManuallyAt} IS NULL AND ${t.closedBy} IS NULL AND ${t.closeReason} IS NULL)
          OR (${t.closedManuallyAt} IS NOT NULL AND ${t.closedBy} IS NOT NULL AND ${t.closeReason} IS NOT NULL)`,
    ),

    /** A required reason that accepts ' ' is not a required reason. */
    check(
      "po_item_close_reason_not_blank",
      sql`${t.closeReason} IS NULL OR btrim(${t.closeReason}) <> ''`,
    ),
  ],
);

export type Design = typeof design.$inferSelect;
export type PurchaseOrder = typeof purchaseOrder.$inferSelect;
export type PoItem = typeof poItem.$inferSelect;
