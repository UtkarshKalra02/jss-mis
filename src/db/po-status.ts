import { sql } from "drizzle-orm";

import type { Tx } from "./audit";
import { db } from "./index";

/**
 * The two sanctioned writers of purchase_order.status and po_item.status
 * (decision B5), on the TypeScript side.
 *
 * The database refuses any other writer outright: migration 0006 puts a
 * BEFORE UPDATE trigger on both columns that raises unless the transaction-local
 * setting `jss.allow_status_write` is on. That is the enforcement. Nothing in
 * this file is load-bearing for the rule — it is the key, not the lock, and a
 * screen that forgets to use it gets a database exception rather than a wrong
 * status.
 *
 * The recompute half needs no help from here at all. It runs from AFTER
 * triggers on dispatch_line, dispatch and po_item.ordered_qty, so there is no
 * call site to forget. What is left for the application is:
 *
 *   - withStatusWrite(), for the explicit Cancel action (F6)
 *   - recomputeAllStatuses(), for the nightly safety net
 */

/**
 * Opens the status write lock for the duration of `fn`, then shuts it again.
 *
 * ONLY the Cancel action should use this. Everything else that changes a
 * status does so as a consequence of dispatch quantities changing, and is
 * handled by the triggers.
 *
 *   await db.transaction(async (tx) =>
 *     withStatusWrite(tx, () =>
 *       auditedUpdate(actor, poItem, id, { status: "Cancelled" }, tx),
 *     ),
 *   );
 *
 * Note the shape: the audited write still happens through the wrapper, so the
 * Cancel is logged like every other change (non-negotiable 3). This only makes
 * the database willing to accept it.
 *
 * There is deliberately no try/finally. If `fn` throws, the transaction is
 * doomed and the setting dies with it — `set_config(..., is_local => true)`
 * reverts on rollback. A finally block would issue a statement against an
 * already-aborted transaction and replace the real error with a confusing one
 * about the transaction being aborted.
 */
export async function withStatusWrite<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('jss.allow_status_write', 'on', true)`);
  const result = await fn();
  await tx.execute(sql`select set_config('jss.allow_status_write', 'off', true)`);
  return result;
}

/**
 * Recomputes every live PO item and the orders above them.
 *
 * The spec says status is derived "nightly + on write". The triggers do the
 * on-write half completely; this is the nightly half, and it exists to catch
 * drift that the triggers cannot see — a row repaired by hand at psql, a
 * restore from backup, a migration that moved quantities around.
 *
 * It is not a no-op safety net that costs nothing to run: the SQL functions
 * only write when the computed value actually DIFFERS from the stored one, so
 * a night with no drift writes nothing and logs nothing. If this ever shows a
 * non-zero change count on a quiet day, something bypassed the triggers and
 * that is worth knowing about — which is why the count is returned rather than
 * discarded.
 */
export async function recomputeAllStatuses(): Promise<{ items: number }> {
  const result = await db.execute<{ recompute_for_po_item: null }>(
    sql`select recompute_for_po_item(id) from po_item where deleted_at is null`,
  );

  return { items: result.rows.length };
}

/** One item and its order. For a targeted repair, or a test. */
export async function recomputeForPoItem(poItemId: string, tx?: Tx): Promise<void> {
  const runner = tx ?? db;
  await runner.execute(sql`select recompute_for_po_item(${poItemId}::uuid)`);
}
