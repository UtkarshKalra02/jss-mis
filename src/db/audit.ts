import { eq, getTableName } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { Role } from "@/auth/roles";

import { db } from "./index";
import { auditLog } from "./schema";

/**
 * THE AUDIT WRAPPER — the only write path in this application.
 *
 * Nothing outside this file may call db.insert / db.update / db.delete on a
 * business table. Everything goes through the five functions below, which
 * exist to make three of the non-negotiables true rather than aspirational:
 *
 *   3. Every write is audited.  The mutation and its audit_log row are written
 *      inside ONE transaction, so a change can never land without its trail.
 *      This is enforced by the database, not by anyone remembering to log.
 *
 *   7. Soft delete only.        There is no hard-delete function here. The
 *      application physically cannot issue a DELETE.
 *
 *   B2. OWNER is read-only.     Checked here, at the choke point, rather than
 *      per screen — so a future page that forgets its guard still cannot let
 *      an OWNER write anything.
 *
 * If you find yourself wanting to bypass this for a bulk operation, pass a
 * transaction in instead (every function takes an optional `tx`), so the whole
 * batch stays inside one transaction and one audit trail.
 */

/** Seeded in migration 0003. Fixed so it can be referenced without a lookup. */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export type Actor = { id: string; role: Role };

/**
 * For writes with no human behind them: the nightly PO-status recompute, the
 * Phase 2 historical import, seed scripts. Decision C4.
 */
export const SYSTEM_ACTOR: Actor = { id: SYSTEM_USER_ID, role: "ADMIN" };

/** Thrown when an OWNER attempts any write. Caught and shown as a 403. */
export class ReadOnlyRoleError extends Error {
  constructor(readonly role: Role) {
    super(`${role} is a read-only role and cannot modify data.`);
    this.name = "ReadOnlyRoleError";
  }
}

export class RecordNotFoundError extends Error {
  constructor(table: string, id: string) {
    super(`No ${table} with id ${id}.`);
    this.name = "RecordNotFoundError";
  }
}

/**
 * Fields whose VALUES must never reach the audit log.
 *
 * An audit trail containing password hashes is a second copy of the credential
 * table with weaker access control — audit rows are read by more people, for
 * longer, than app_user ever is. The log records THAT a credential changed;
 * it must not record what it changed to.
 */
const REDACTED_FIELDS = new Set(["passwordHash", "password_hash"]);

function redact(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = REDACTED_FIELDS.has(key) ? (value === null ? null : "[redacted]") : value;
  }
  return out;
}

/**
 * Tables this wrapper can operate on: everything carrying the standard column
 * set from _shared.ts. stage_event and audit_log are deliberately excluded —
 * both are append-only, and the database refuses to update or delete them.
 */
type AuditableTable = PgTable & {
  id: PgColumn;
  createdBy: PgColumn;
  updatedBy: PgColumn;
  deletedAt: PgColumn;
};

/**
 * Append-only tables, which cannot satisfy AuditableTable and must not be
 * asked to (decision C6).
 *
 * stage_event is the only one. It has no updated_by, no deleted_at and no
 * updated_at, because it is never updated and never deleted — the database
 * raises on both. What it has instead is `entered_by`, which is the append-only
 * counterpart of created_by, and requiring it in the type is what makes an
 * unattributed event impossible to write rather than merely discouraged.
 *
 * audit_log is also append-only but is deliberately NOT reachable here: it is
 * written by this file and auditing it would be circular.
 */
type AppendOnlyTable = PgTable & {
  id: PgColumn;
  enteredBy: PgColumn;
};

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Runner = typeof db | Tx;

/**
 * Runs `fn` inside a transaction. If the caller already has one, it is reused
 * so several audited writes commit or fail together; otherwise a fresh one is
 * opened for this single write.
 */
function inTransaction<T>(tx: Runner | undefined, fn: (r: Runner) => Promise<T>): Promise<T> {
  if (tx) return fn(tx);
  return db.transaction((fresh) => fn(fresh));
}

function assertCanWrite(actor: Actor) {
  if (actor.role === "OWNER") throw new ReadOnlyRoleError(actor.role);
}

type AnyRow = Record<string, unknown>;

/**
 * Drizzle's query builders are generic over a *concrete* table; they cannot
 * express "any table that has these columns", which is exactly what a generic
 * wrapper needs. Rather than scatter casts through every function, the whole
 * untyped boundary is this one interface, describing the narrow slice of the
 * builder API used below.
 *
 * The exported signatures stay fully typed, so call sites get real checking on
 * both the values they pass and the row they get back. The unchecked part is
 * confined to a file that gets read carefully.
 */
type GenericWriter = {
  insert(table: PgTable): {
    values(values: AnyRow): { returning(): Promise<AnyRow[]> };
  };
  update(table: PgTable): {
    set(values: AnyRow): {
      where(condition: SQL): { returning(): Promise<AnyRow[]> };
    };
  };
  select(): {
    from(table: PgTable): { where(condition: SQL): Promise<AnyRow[]> };
  };
};

const generic = (r: Runner) => r as unknown as GenericWriter;
const typed = (r: Runner) => r as typeof db;

export async function auditedInsert<T extends AuditableTable>(
  actor: Actor,
  table: T,
  values: InferInsertModel<T>,
  tx?: Runner,
): Promise<InferSelectModel<T>> {
  assertCanWrite(actor);

  return inTransaction(tx, async (r) => {
    const [row] = await generic(r)
      .insert(table)
      .values({ ...values, createdBy: actor.id, updatedBy: actor.id })
      .returning();

    await typed(r).insert(auditLog).values({
      tableName: getTableName(table),
      recordId: row!.id as string,
      action: "INSERT",
      changedBy: actor.id,
      before: null,
      after: redact(row),
    });

    return row as InferSelectModel<T>;
  });
}

/**
 * Appends a row to an append-only table — in practice, a stage event.
 *
 * WHY THIS EXISTS (decision F1). The wrapper's other four functions all
 * require created_by / updated_by / deleted_at, which stage_event deliberately
 * does not have. The effect was that the single table Phase 2 exists to write
 * had no audited write path at all, so non-negotiable 3 and the OWNER
 * deny-write rule both had a hole exactly where the next six screens land.
 * Relying on `entered_by` alone would have recorded who, but nothing would
 * have recorded THAT a write happened in the log that is supposed to be
 * complete.
 *
 * There is no auditedAppendUpdate and no auditedAppendDelete, and there will
 * not be. Corrections to an append-only table are made by appending a
 * correcting row; the database raises on any other attempt (migration 0001).
 *
 * `entered_by` is stamped from the actor rather than taken from the caller,
 * for the same reason auditedInsert stamps created_by: the person the audit
 * row names and the person the event names must not be able to disagree.
 */
export async function auditedAppend<T extends AppendOnlyTable>(
  actor: Actor,
  table: T,
  values: InferInsertModel<T>,
  tx?: Runner,
): Promise<InferSelectModel<T>> {
  assertCanWrite(actor);

  return inTransaction(tx, async (r) => {
    const [row] = await generic(r)
      .insert(table)
      .values({ ...values, enteredBy: actor.id })
      .returning();

    await typed(r).insert(auditLog).values({
      tableName: getTableName(table),
      recordId: row!.id as string,
      action: "INSERT",
      changedBy: actor.id,
      before: null,
      after: redact(row),
    });

    return row as InferSelectModel<T>;
  });
}

export async function auditedUpdate<T extends AuditableTable>(
  actor: Actor,
  table: T,
  id: string,
  values: Partial<InferInsertModel<T>>,
  tx?: Runner,
): Promise<InferSelectModel<T>> {
  assertCanWrite(actor);

  return inTransaction(tx, async (r) => {
    const [before] = await generic(r).select().from(table).where(eq(table.id, id));

    if (!before) throw new RecordNotFoundError(getTableName(table), id);

    const [after] = await generic(r)
      .update(table)
      .set({ ...values, updatedBy: actor.id })
      .where(eq(table.id, id))
      .returning();

    await typed(r).insert(auditLog).values({
      tableName: getTableName(table),
      recordId: id,
      action: "UPDATE",
      changedBy: actor.id,
      before: redact(before),
      after: redact(after),
    });

    return after as InferSelectModel<T>;
  });
}

/**
 * Soft delete — the only kind there is (non-negotiable 7).
 *
 * Sets deleted_at. The row stays, its foreign keys stay valid, and the partial
 * unique indexes free its natural key for reuse.
 */
export async function auditedSoftDelete<T extends AuditableTable>(
  actor: Actor,
  table: T,
  id: string,
  tx?: Runner,
): Promise<InferSelectModel<T>> {
  assertCanWrite(actor);

  return inTransaction(tx, async (r) => {
    const [before] = await generic(r).select().from(table).where(eq(table.id, id));

    if (!before) throw new RecordNotFoundError(getTableName(table), id);

    const [after] = await generic(r)
      .update(table)
      .set({ deletedAt: new Date(), updatedBy: actor.id })
      .where(eq(table.id, id))
      .returning();

    await typed(r).insert(auditLog).values({
      tableName: getTableName(table),
      recordId: id,
      action: "SOFT_DELETE",
      changedBy: actor.id,
      before: redact(before),
      after: redact(after),
    });

    return after as InferSelectModel<T>;
  });
}

/** Undoes a soft delete. Recorded as its own action, not as a plain update. */
export async function auditedRestore<T extends AuditableTable>(
  actor: Actor,
  table: T,
  id: string,
  tx?: Runner,
): Promise<InferSelectModel<T>> {
  assertCanWrite(actor);

  return inTransaction(tx, async (r) => {
    const [before] = await generic(r).select().from(table).where(eq(table.id, id));

    if (!before) throw new RecordNotFoundError(getTableName(table), id);

    const [after] = await generic(r)
      .update(table)
      .set({ deletedAt: null, updatedBy: actor.id })
      .where(eq(table.id, id))
      .returning();

    await typed(r).insert(auditLog).values({
      tableName: getTableName(table),
      recordId: id,
      action: "RESTORE",
      changedBy: actor.id,
      before: redact(before),
      after: redact(after),
    });

    return after as InferSelectModel<T>;
  });
}
