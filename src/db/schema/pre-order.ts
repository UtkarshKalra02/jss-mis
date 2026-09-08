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

import { baseColumns, MONEY } from "./_shared";
import { enquiryLostReasonEnum, enquiryStatusEnum, quotationStatusEnum } from "./enums";
import { client } from "./reference";
import { appUser } from "./users";

/* -------------------------------------------------------------------------- */
/* enquiry_source                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where an enquiry came from — a TABLE, not an enum.
 *
 * The build spec asked for "enum, ADMIN-editable lookup", which cannot both be
 * true: changing a Postgres enum is a migration and a deploy, so an admin
 * screen over one would be a lie. This follows `stage` instead, which is the
 * pattern already established for a list the factory owns rather than the
 * code — and which non-negotiable 5 exists to protect. The day somebody starts
 * getting work through Instagram, that is a row, not a release.
 *
 * Deactivated rather than deleted, for the same reason a stage is: enquiries
 * already recorded against a source must keep reading correctly after it stops
 * being offered on the form.
 */
export const enquirySource = pgTable(
  "enquiry_source",
  {
    ...baseColumns(),

    /** REFERRAL, INDIAMART. Stable; the display name is what gets edited. */
    code: text().notNull(),
    name: text().notNull(),

    sequence: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("enquiry_source_code_key")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index("enquiry_source_sequence_idx").on(t.sequence),
  ],
);

/* -------------------------------------------------------------------------- */
/* enquiry                                                                     */
/* -------------------------------------------------------------------------- */

export const enquiry = pgTable(
  "enquiry",
  {
    ...baseColumns(),

    /** ENQ-YYYY-NNNN, financial year. */
    enquiryNo: text().notNull(),

    clientId: uuid()
      .notNull()
      .references(() => client.id),

    /**
     * Defaults to today in IST, not UTC. An enquiry taken at 9pm in Delhi is
     * 15:30 UTC the SAME day, and `current_date` on a UTC server would file it
     * under yesterday — which would also hand it the wrong financial year
     * every 31 March. Same reasoning as `today_ist()` in the derived views.
     */
    enquiryDate: date()
      .notNull()
      .default(sql`today_ist()`),

    sourceId: uuid()
      .notNull()
      .references(() => enquirySource.id),

    /** Who sent them, when the source is a referral. Free text by design. */
    referredBy: text(),

    /** Free text, NOT a design FK — at enquiry stage there is no design yet. */
    itemDescription: text().notNull(),
    qty: integer(),

    /**
     * THE CLIENT'S STATED ASK, and nothing more.
     *
     * It must never be copied into `po_item.committed_date`. What a client
     * asks for and what this factory commits to are different numbers, and
     * OTD is measured against the second one — silently promoting an ask into
     * a commitment would make the factory late against a date nobody here ever
     * agreed to.
     */
    clientRequiredDate: date(),

    /**
     * An enquiry that never converts stays in the system as 'Lost' rather
     * than being deleted — the quote-to-win rate is meaningless without the
     * losses.
     */
    status: enquiryStatusEnum().notNull().default("Open"),
    lostReason: enquiryLostReasonEnum(),
    lostNotes: text(),

    /** Set when status moves to Won, Lost or Dropped. */
    closedAt: date(),

    ownerUserId: uuid()
      .notNull()
      .references(() => appUser.id),
  },
  (t) => [
    uniqueIndex("enquiry_no_key")
      .on(t.enquiryNo)
      .where(sql`${t.deletedAt} is null`),
    index("enquiry_client_idx").on(t.clientId),
    index("enquiry_status_idx").on(t.status),
    index("enquiry_source_idx").on(t.sourceId),
    index("enquiry_owner_idx").on(t.ownerUserId),

    // Spec section 4.2: lost_reason is required when status = Lost. Enforced
    // in the database, not only in the form, so a bulk update or a script
    // cannot produce a Lost enquiry with no explanation.
    //
    // The blank-string half of the old check is gone with the text column —
    // an enum cannot hold one.
    check(
      "enquiry_lost_reason_required",
      sql`${t.status} <> 'Lost' or ${t.lostReason} is not null`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* quotation                                                                   */
/* -------------------------------------------------------------------------- */

export const quotation = pgTable(
  "quotation",
  {
    ...baseColumns(),

    /** QT-YYYY-NNNN, financial year. */
    quoteNo: text().notNull(),

    enquiryId: uuid()
      .notNull()
      .references(() => enquiry.id),

    quoteDate: date().notNull(),
    validUntil: date(),

    /** Manually entered. There is no costing engine in v1 by design. */
    ratePerUnit: numeric(MONEY),
    totalValue: numeric(MONEY),

    status: quotationStatusEnum().notNull().default("Sent"),
    notes: text(),
  },
  (t) => [
    uniqueIndex("quotation_no_key")
      .on(t.quoteNo)
      .where(sql`${t.deletedAt} is null`),
    index("quotation_enquiry_idx").on(t.enquiryId),
  ],
);

export type Enquiry = typeof enquiry.$inferSelect;
export type EnquirySource = typeof enquirySource.$inferSelect;
export type Quotation = typeof quotation.$inferSelect;
