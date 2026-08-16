import { timestamp, uuid } from "drizzle-orm/pg-core";

import { appUser } from "./users";

/**
 * The standard column set from spec section 4: every table carries id,
 * created_at, updated_at, created_by, updated_by, and a soft-delete marker.
 *
 * Spread this into a table definition rather than retyping the columns, so
 * they cannot drift apart table by table:
 *
 *   export const client = pgTable("client", {
 *     ...baseColumns(),
 *     name: text().notNull(),
 *   });
 *
 * TWO TABLES DELIBERATELY DO NOT USE IT (decision C6):
 *
 *   stage_event — append-only. It is never updated and never deleted, so
 *                 updated_at/updated_by/deleted_at would be dead columns that
 *                 imply a mutability the design forbids. It carries its own
 *                 entered_by/event_at instead.
 *
 *   audit_log   — it IS the audit trail. Auditing it is circular, and a
 *                 soft-deletable audit log is not an audit log.
 *
 * created_by/updated_by are nullable because not every write has a human
 * behind it: migrations, the nightly PO-status recompute, and the seed all
 * act as the SYSTEM user, and the very first row written has no author yet.
 */
export function baseColumns() {
  return {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => appUser.id),
    updatedBy: uuid().references(() => appUser.id),
    deletedAt: timestamp({ withTimezone: true }),
  };
}

/** Money. Spec section 4: all monetary values are numeric(14,2). */
export const MONEY = { precision: 14, scale: 2 } as const;
