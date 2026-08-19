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
import { dispatchStatusEnum } from "./enums";
import { importBatch } from "./imports";
import { poItem } from "./order";
import { client } from "./reference";

/* -------------------------------------------------------------------------- */
/* dispatch                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * OTD IS DECIDED HERE.
 *
 * When the dispatch line that brings an item's pending_qty to zero is saved,
 * this dispatch's dispatch_date becomes that item's fulfilment date, and the
 * item is on time if that date is on or before its committed_date.
 *
 * dispatch_date is a DATE, not a timestamp, and is entered by a human — it is
 * the date the goods left, which is a business fact, not a system event. That
 * is also why it must never be compared against a UTC timestamp without an
 * Asia/Kolkata cast first.
 */
export const dispatch = pgTable(
  "dispatch",
  {
    ...baseColumns(),

    /** CH-YYYY-NNNN, financial year. */
    challanNo: text().notNull(),

    clientId: uuid()
      .notNull()
      .references(() => client.id),

    dispatchDate: date().notNull(),

    vehicleNo: text(),
    transporter: text(),
    ewayBillNo: text(),

    status: dispatchStatusEnum().notNull().default("Draft"),
    remarks: text(),

    /** See purchase_order.import_batch_id. */
    importBatchId: uuid().references(() => importBatch.id),
  },
  (t) => [
    uniqueIndex("dispatch_challan_no_key")
      .on(t.challanNo)
      .where(sql`${t.deletedAt} is null`),
    index("dispatch_client_idx").on(t.clientId),
    index("dispatch_date_idx").on(t.dispatchDate),
    index("dispatch_status_idx").on(t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* dispatch_line                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Partial delivery is the normal case, not the exception — an item is
 * routinely delivered across several challans.
 *
 * Two rules cannot be expressed as column constraints and are enforced by
 * triggers in the migration that follows this schema:
 *
 *   1. SUM(qty) per po_item must never exceed po_item.ordered_qty. A CHECK
 *      constraint cannot see other rows, so this needs a trigger.
 *   2. The item's client must match dispatch.client_id. The two foreign keys
 *      here are individually valid while jointly nonsense — nothing stops a
 *      line on NAT's challan pointing at MUL's item (decision C8).
 */
export const dispatchLine = pgTable(
  "dispatch_line",
  {
    ...baseColumns(),

    dispatchId: uuid()
      .notNull()
      .references(() => dispatch.id, { onDelete: "cascade" }),

    poItemId: uuid()
      .notNull()
      .references(() => poItem.id),

    qty: integer().notNull(),
    rate: numeric(MONEY),

    /** See purchase_order.import_batch_id. */
    importBatchId: uuid().references(() => importBatch.id),
  },
  (t) => [
    index("dispatch_line_dispatch_idx").on(t.dispatchId),
    index("dispatch_line_po_item_idx").on(t.poItemId),
    check("dispatch_line_qty_positive", sql`${t.qty} > 0`),
  ],
);

export type Dispatch = typeof dispatch.$inferSelect;
export type DispatchLine = typeof dispatchLine.$inferSelect;
