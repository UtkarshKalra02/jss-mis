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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns } from "./_shared";
import { materialReorderMethodEnum, materialReorderNoteEnum, materialUnitEnum } from "./enums";

/**
 * IMS — material stock: board, ink, chemicals, foil, consumables (section O).
 *
 * Built from the factory's own "IMS Jss the print zone" sheet, which had been
 * batch-level since 31 Jul 2026: a GRN brings batches in, issues and
 * adjustments take from a batch, and what a batch has left is arithmetic.
 * That shape is kept exactly, because it is the shape the store already keeps.
 *
 * THE RULE THIS FILE IS BUILT AROUND: nothing here stores a stock figure.
 * `remaining` per batch and `closing_stock` per material are computed in
 * `v_material_batch_stock` and `v_material_stock` (migration 0039) from the
 * rows below, the way pending_qty is (non-negotiable 2). The backlog's reason
 * for refusing an IMS for three months was "a stock count that nothing
 * decrements is right on the day it is typed and wrong every day after". A
 * stored total would be that count.
 */

/* -------------------------------------------------------------------------- */
/* material_category, material_type                                            */
/* -------------------------------------------------------------------------- */

/**
 * Paper, Ink, Chemical, Adhesive … — and Sbs Paper, Art Card, Solution … .
 *
 * TABLES, NOT ENUMS (C3): the list belongs to the store and grows when a new
 * kind of thing is bought, which should be a row rather than a migration.
 * `code` is the fragment that builds a SKU: category P + type SBS → P-SBS-001,
 * which is the sheet's own scheme and is kept so every existing SKU imports
 * unchanged.
 *
 * A type is NOT tied to a category. The sheet's config lists them as two
 * independent vocabularies, and "Coating" is both; forcing a parent would
 * mean inventing one.
 */
export const materialCategory = pgTable(
  "material_category",
  {
    ...baseColumns(),
    code: text().notNull(),
    name: text().notNull(),
    sequence: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("material_category_code_key")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const materialType = pgTable(
  "material_type",
  {
    ...baseColumns(),
    code: text().notNull(),
    name: text().notNull(),
    sequence: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("material_type_code_key")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* material — the item master                                                  */
/* -------------------------------------------------------------------------- */

export const material = pgTable(
  "material",
  {
    ...baseColumns(),

    /** P-SBS-001, CH-SOL-116 — the sheet's codes, kept. See sku.ts. */
    sku: text().notNull(),

    name: text().notNull(),

    categoryId: uuid()
      .notNull()
      .references(() => materialCategory.id),
    typeId: uuid()
      .notNull()
      .references(() => materialType.id),

    /** "23X36", "20X30" — as the trade writes it. */
    size: text(),

    /**
     * GSM for paper, micron for film — A NUMBER, where the sheet had "330Gsm"
     * as text. The job card's paper picker orders candidates by distance from
     * the GSM the job wants (O2), and a distance needs arithmetic.
     */
    gsm: integer(),

    colour: text(),
    finish: text(),

    unit: materialUnitEnum().notNull(),

    isActive: boolean().notNull().default(true),

    /* ---------------------------------------------------------------------- */
    /* Reorder figures — typed; what the view DERIVES from them is in 0040     */
    /* ---------------------------------------------------------------------- */

    /**
     * The sheet's Calc Method (P2). Decides which of the figures below mean
     * anything: an On-demand item computes nothing; a Consumption item gets
     * days remaining and a max level from its actual issues; an Interval item
     * is watched for a missed issue.
     */
    reorderMethod: materialReorderMethodEnum().notNull().default("On demand"),

    /** Indent to receipt, in days. */
    leadTimeDays: integer(),
    minOrderQty: numeric({ precision: 12, scale: 2 }),

    /**
     * The multiplier in max level = ADC × lead time × factor — the sheet's
     * unnamed column M. 2 means "hold two lead times' worth".
     */
    safetyFactor: numeric({ precision: 6, scale: 2 }),

    /** Interval items: how many days normally pass between issues. */
    issueIntervalDays: numeric({ precision: 6, scale: 1 }),

    /**
     * SUPERSEDED BY THE VIEW (P2). Both were imported from the sheet on
     * 19 Sep 2026 and are no longer read or written by any screen: ADC is now
     * computed from issues and max level from ADC. Kept only because dropping
     * a column is a deploy-first migration (DEPLOYMENT.md §6); BACKLOG has it.
     */
    averageDailyConsumption: numeric({ precision: 12, scale: 2 }),
    maxLevel: numeric({ precision: 12, scale: 2 }),

    /**
     * Ordered but not arrived. TYPED, not derived, because there is no
     * purchase-order-to-vendor workflow for it to derive from (O4), and the
     * sheet carried it as a hand figure too. Cleared when the GRN is entered
     * — by the person, which the GRN form reminds them of.
     */
    inTransitQty: numeric({ precision: 12, scale: 2 }),

    /**
     * A person's word on the reorder list (P2): Ordered, Hold or Ignore,
     * with the day it was said. The sheet logged these in Reorder History;
     * here the audit log is the history.
     */
    reorderNote: materialReorderNoteEnum(),
    reorderNoteOn: date(),

    /** A photo of the thing, for the store to recognise it — the sheet's Form responses 4. */
    imageUrl: text(),

    remarks: text(),
  },
  (t) => [
    uniqueIndex("material_sku_key")
      .on(t.sku)
      .where(sql`${t.deletedAt} is null`),
    index("material_category_idx").on(t.categoryId),
    index("material_type_idx").on(t.typeId),
    index("material_gsm_idx").on(t.gsm),

    check("material_gsm_positive", sql`${t.gsm} is null or ${t.gsm} > 0`),
    check("material_lead_time_non_negative", sql`${t.leadTimeDays} is null or ${t.leadTimeDays} >= 0`),
    check(
      "material_issue_interval_positive",
      sql`${t.issueIntervalDays} is null or ${t.issueIntervalDays} > 0`,
    ),
    check("material_safety_factor_non_negative", sql`${t.safetyFactor} is null or ${t.safetyFactor} >= 0`),
    check(
      "material_in_transit_non_negative",
      sql`${t.inTransitQty} is null or ${t.inTransitQty} >= 0`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* grn, material_batch                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A goods receipt: one vendor invoice or challan, arriving on a day.
 *
 * The scan is a pasted Drive link, as the PO scan is (F5). The sheet did the
 * same.
 */
export const grn = pgTable(
  "grn",
  {
    ...baseColumns(),

    /** GRN-YYYY-NNNN, financial year, from the shared allocator (C7). */
    grnNo: text().notNull(),

    receivedDate: date().notNull(),
    vendor: text().notNull(),
    invoiceNo: text(),
    invoiceUrl: text(),
    remarks: text(),
  },
  (t) => [
    uniqueIndex("grn_no_key")
      .on(t.grnNo)
      .where(sql`${t.deletedAt} is null`),
    index("grn_received_date_idx").on(t.receivedDate),
  ],
);

/**
 * One line of a receipt: a quantity of one material that arrived together.
 *
 * Issues and adjustments point at a BATCH, not a material, so the store can
 * say which delivery a sheet came from — and so an opening balance imported
 * from the sheet is just a batch with no GRN behind it, which is exactly what
 * the sheet called it ("OPEN-P-SBS-003 … Opening balance").
 *
 * `qty_received` is the only quantity stored. Remaining is the view's.
 */
export const materialBatch = pgTable(
  "material_batch",
  {
    ...baseColumns(),

    /** The sheet's batch ids are kept on import; new ones are GRN no + line. */
    batchNo: text().notNull(),

    /** Null for an opening balance: nothing was received, it was counted. */
    grnId: uuid().references(() => grn.id),

    materialId: uuid()
      .notNull()
      .references(() => material.id),

    receivedDate: date().notNull(),
    qtyReceived: numeric({ precision: 12, scale: 2 }).notNull(),

    /**
     * The job this paper was bought for, when it was bought for one (P3).
     * Free text as the sheet had it — a job name — because most of the
     * ledger predates the MIS's job cards. Issues for that job are offered
     * its own paper first; taking it for another job is warned about, not
     * refused.
     */
    jobRef: text(),

    remarks: text(),
  },
  (t) => [
    uniqueIndex("material_batch_no_key")
      .on(t.batchNo)
      .where(sql`${t.deletedAt} is null`),
    index("material_batch_material_idx").on(t.materialId),
    index("material_batch_grn_idx").on(t.grnId),
    index("material_batch_received_idx").on(t.receivedDate),

    check("material_batch_qty_positive", sql`${t.qtyReceived} > 0`),
  ],
);

export type MaterialCategory = typeof materialCategory.$inferSelect;
export type MaterialType = typeof materialType.$inferSelect;
export type Material = typeof material.$inferSelect;
export type Grn = typeof grn.$inferSelect;
export type MaterialBatch = typeof materialBatch.$inferSelect;
