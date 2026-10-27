import { sql } from "drizzle-orm";
import {
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
import { materialAdjustmentReasonEnum } from "./enums";
import { materialBatch } from "./materials";
import { jobCard } from "./production";

/**
 * Stock leaving a batch, or being corrected on it (section O).
 *
 * IN ITS OWN FILE, not beside the batch it draws from, to keep the schema
 * graph acyclic: an issue names the job card it was for, and a job card names
 * the paper it was printed on (`job_card.material_id`), so materials.ts must
 * not import production.ts. The barrel's order comment says the graph has no
 * cycles by construction; this split is what keeps that true.
 */

/* -------------------------------------------------------------------------- */
/* material_issue, material_adjustment                                         */
/* -------------------------------------------------------------------------- */

/**
 * Material leaving the store for the floor.
 *
 * `job_card_id` is the link the backlog said an IMS was worthless without:
 * paper issued against the card it was cut for. NULLABLE, because chemicals
 * and consumables go to a department, not a job. ENTERED BY A PERSON, never
 * written by releasing a card (O3, "manually for now") — the card's page
 * offers the issue pre-filled, and somebody presses the button.
 *
 * A guard in 0039 refuses an issue that takes a batch below zero. Unlike a
 * challan (K12) there is no honest over-run here: paper that is not in the
 * store cannot leave it, and a count that has drifted is corrected with an
 * adjustment first.
 */
export const materialIssue = pgTable(
  "material_issue",
  {
    ...baseColumns(),

    /** MI-YYYY-NNNN. */
    issueNo: text().notNull(),

    batchId: uuid()
      .notNull()
      .references(() => materialBatch.id),

    issuedOn: date().notNull(),
    qty: numeric({ precision: 12, scale: 2 }).notNull(),
    /**
     * How it was COUNTED, when it went out in bundles (V1).
     *
     * THE LEDGER STAYS IN SHEETS, exactly as on the receipt side: `qty` is the
     * atomic figure, and these record how it was arrived at.
     */
    bundles: integer(),
    sheetsPerBundle: integer(),


    /** Offset Printing, Lamination, Binding … — free text, as the sheet had. */
    department: text(),

    jobCardId: uuid().references(() => jobCard.id),

    /** The job by name, as the ledger recorded it — for issues that predate job cards, and for jobs without one. */
    jobRef: text(),

    remarks: text(),
  },
  (t) => [
    uniqueIndex("material_issue_no_key")
      .on(t.issueNo)
      .where(sql`${t.deletedAt} is null`),
    index("material_issue_batch_idx").on(t.batchId),
    index("material_issue_job_card_idx").on(t.jobCardId),
    index("material_issue_date_idx").on(t.issuedOn),

    check("material_issue_qty_positive", sql`${t.qty} > 0`),
    /**
     * V1. Where the bundle figures are present they must multiply out to the
     * quantity. "5 bundles of 460" recorded against a total of 2,000 is a typo
     * somebody would otherwise find by counting a shelf, months later.
     *
     * THE `is not null` TESTS ARE LOAD-BEARING. A check constraint passes when
     * its expression is NULL, not only when it is true, so `bundles > 0 and
     * sheets_per_bundle > 0` with a null size evaluates to NULL and the row is
     * ACCEPTED — "5 bundles of nothing", the one state that makes the pair
     * useless. Found by a test rather than by review; see 0046.
     */
    check(
      "material_issue_bundles_agree",
      sql`(${t.bundles} is null and ${t.sheetsPerBundle} is null)
          or (${t.bundles} is not null and ${t.sheetsPerBundle} is not null
              and ${t.bundles} > 0 and ${t.sheetsPerBundle} > 0
              and ${t.qty} = ${t.bundles} * ${t.sheetsPerBundle})`,
    ),

  ],
);

/**
 * A count correction, damage, or a return — signed, against a batch.
 *
 * Negative takes stock away, positive puts it back. Zero is refused: an
 * adjustment of nothing is a remark, and remarks go in remarks.
 */
export const materialAdjustment = pgTable(
  "material_adjustment",
  {
    ...baseColumns(),

    /** MA-YYYY-NNNN. */
    adjustmentNo: text().notNull(),

    batchId: uuid()
      .notNull()
      .references(() => materialBatch.id),

    adjustedOn: date().notNull(),
    qty: numeric({ precision: 12, scale: 2 }).notNull(),
    reason: materialAdjustmentReasonEnum().notNull(),
    remarks: text(),
  },
  (t) => [
    uniqueIndex("material_adjustment_no_key")
      .on(t.adjustmentNo)
      .where(sql`${t.deletedAt} is null`),
    index("material_adjustment_batch_idx").on(t.batchId),
    index("material_adjustment_date_idx").on(t.adjustedOn),

    check("material_adjustment_qty_nonzero", sql`${t.qty} <> 0`),
  ],
);

export type MaterialIssue = typeof materialIssue.$inferSelect;
export type MaterialAdjustment = typeof materialAdjustment.$inferSelect;
