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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns, MONEY } from "./_shared";
import {
  approvalStatusEnum,
  committedDateBasisEnum,
  dieplateStatusEnum,
  jobTypeEnum,
  poItemStatusEnum,
  priorityEnum,
  purchaseOrderStatusEnum,
} from "./enums";
import { enquiry } from "./pre-order";
import { client, stage } from "./reference";
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

    dieId: text(),
    plateId: text(),
    dieStatus: dieplateStatusEnum().notNull().default("NA"),
    plateStatus: dieplateStatusEnum().notNull().default("NA"),

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

    // An approval without a timestamp and an approver is not an approval.
    check(
      "design_approval_complete",
      sql`${t.approvalStatus} <> 'Approved' or (${t.approvedAt} is not null and ${t.approvedBy} is not null)`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* design_process                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Which stages a design actually passes through.
 *
 * Replaces the spec's `design.processes text[]` (decision C1). An array column
 * cannot carry a foreign key, so a typo like 'LAMINATON' would sit in the
 * database undetected until a report quietly under-counted. As a junction
 * table each entry is FK-checked against stage.code, which is what
 * non-negotiable 4 requires, and "which designs need foiling?" becomes an
 * ordinary join instead of an array scan.
 */
export const designProcess = pgTable(
  "design_process",
  {
    ...baseColumns(),

    designId: uuid()
      .notNull()
      .references(() => design.id, { onDelete: "cascade" }),

    stageCode: text()
      .notNull()
      .references(() => stage.code),

    /** Order within this design's route, if it differs from stage.sequence. */
    sequence: integer(),
  },
  (t) => [
    unique("design_process_design_stage_key").on(t.designId, t.stageCode),
    index("design_process_stage_idx").on(t.stageCode),
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
     * DERIVED, but stored (decision B5). Recomputed on write and nightly from
     * the item rows underneath it. Only the recompute function and the
     * explicit Cancel action may write this column — never a form. It is a
     * column rather than a view because it is filtered and indexed constantly,
     * and because 'Cancelled' is a human decision that cannot be derived from
     * dispatch quantities.
     */
    status: purchaseOrderStatusEnum().notNull().default("Open"),

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
  },
  (t) => [
    uniqueIndex("po_item_code_key")
      .on(t.itemCode)
      .where(sql`${t.deletedAt} is null`),
    index("po_item_purchase_order_idx").on(t.purchaseOrderId),
    index("po_item_design_idx").on(t.designId),
    index("po_item_committed_date_idx").on(t.committedDate),
    index("po_item_status_idx").on(t.status),

    check("po_item_ordered_qty_positive", sql`${t.orderedQty} > 0`),
  ],
);

export type Design = typeof design.$inferSelect;
export type PurchaseOrder = typeof purchaseOrder.$inferSelect;
export type PoItem = typeof poItem.$inferSelect;
