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

import { baseColumns, MONEY } from "./_shared";
import { enquiryStatusEnum, quotationStatusEnum } from "./enums";
import { client } from "./reference";
import { appUser } from "./users";

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

    enquiryDate: date().notNull(),
    description: text(),
    expectedQty: integer(),

    /**
     * An enquiry that never converts stays in the system as 'Lost' rather
     * than being deleted — the quote-to-win rate is meaningless without the
     * losses.
     */
    status: enquiryStatusEnum().notNull().default("Open"),
    lostReason: text(),
    closedAt: date(),

    ownerUserId: uuid().references(() => appUser.id),
  },
  (t) => [
    uniqueIndex("enquiry_no_key")
      .on(t.enquiryNo)
      .where(sql`${t.deletedAt} is null`),
    index("enquiry_client_idx").on(t.clientId),
    index("enquiry_status_idx").on(t.status),

    // Spec section 4.2: lost_reason is required when status = Lost. Enforced
    // in the database, not only in the form, so a bulk update or a script
    // cannot produce a Lost enquiry with no explanation.
    check(
      "enquiry_lost_reason_required",
      sql`${t.status} <> 'Lost' or (${t.lostReason} is not null and length(trim(${t.lostReason})) > 0)`,
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
export type Quotation = typeof quotation.$inferSelect;
