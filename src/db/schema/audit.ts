import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { auditActionEnum } from "./enums";
import { appUser } from "./users";

/**
 * audit_log — every write in the system, with before and after state.
 *
 * Rows are written by the audit wrapper (src/db/audit.ts) inside the same
 * transaction as the mutation itself, so a change can never land without its
 * audit row. Non-negotiable 3 depends on that transactional coupling, not on
 * anyone remembering to log.
 *
 * Deliberately does not use baseColumns() (decision C6): auditing the audit
 * log is circular, and a soft-deletable audit log is not an audit log. It is
 * append-only, like stage_event.
 *
 * record_id is a plain uuid with no foreign key on purpose — it points at rows
 * in a dozen different tables, and an FK to any one of them is impossible. It
 * also must survive independently of what it describes.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),

    tableName: text().notNull(),
    recordId: uuid().notNull(),
    action: auditActionEnum().notNull(),

    /**
     * Nullable so a write is never blocked by attribution. In practice this is
     * always set: human writes carry the session user, and migrations, seeds,
     * and the nightly recompute act as the SYSTEM user.
     */
    changedBy: uuid().references(() => appUser.id),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    before: jsonb(),
    after: jsonb(),
  },
  (t) => [
    // "What happened to this record?" — the query this table exists for.
    index("audit_log_record_idx").on(t.tableName, t.recordId, t.changedAt.desc()),
    index("audit_log_changed_at_idx").on(t.changedAt.desc()),
    index("audit_log_changed_by_idx").on(t.changedBy),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
