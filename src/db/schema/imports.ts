import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { baseColumns } from "./_shared";
import { appUser } from "./users";

/* -------------------------------------------------------------------------- */
/* import_batch                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One run of the historical importer.
 *
 * Exists so a bad batch can be identified and reversed. Without it, forty jobs
 * entered from a mistyped spreadsheet would have to be unpicked by hand from an
 * audit log, one row at a time, working out which of them came from the file
 * and which somebody typed the same afternoon.
 *
 * The rows it created point BACK at it (import_batch_id on purchase_order,
 * po_item, dispatch and dispatch_line) rather than the batch holding a list.
 * A foreign key survives; a list of ids in a column does not stay true when a
 * row is deleted.
 *
 * UNDO IS A SOFT DELETE, and it cannot be anything else. stage_event is
 * append-only, enforced by a database trigger, so the PO_RECEIVED and
 * DISPATCHED events a batch wrote cannot be removed. Soft-deleting the po_item
 * rows takes them out of v_po_item_status and therefore out of every view
 * built on it, which leaves the events attached to rows nothing displays. That
 * is the correct outcome rather than a workaround: what was entered and then
 * withdrawn is exactly what an audit trail is for.
 */
export const importBatch = pgTable(
  "import_batch",
  {
    ...baseColumns(),

    /** The uploaded file's name, as the person will recognise it. */
    filename: text().notNull(),

    /** Rows the file contained, including the ones that were rejected. */
    rowCount: integer().notNull().default(0),

    /** Rows that actually became purchase orders. */
    importedCount: integer().notNull().default(0),

    /** Rows skipped as duplicates of something already in the system. */
    skippedCount: integer().notNull().default(0),

    importedBy: uuid()
      .notNull()
      .references(() => appUser.id),

    /** Set when the batch is reversed. A batch is undone at most once. */
    undoneAt: timestamp({ withTimezone: true }),
    undoneBy: uuid().references(() => appUser.id),
  },
  (t) => [
    index("import_batch_imported_by_idx").on(t.importedBy),
    index("import_batch_created_at_idx").on(sql`created_at desc`),
  ],
);

export type ImportBatch = typeof importBatch.$inferSelect;
