import { db } from "@/db";
import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { jobCard, jobCardItem } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";

const ROLLBACK = Symbol("rollback");

/**
 * Runs a test body inside a transaction that is ALWAYS rolled back.
 *
 * These tests run against the real Neon database — the constraint triggers and
 * derived views only exist there, so testing them against a mock would test
 * the mock. Rolling back keeps that safe: nothing a test writes survives it.
 *
 * Pass the `tx` down into the audit wrapper so its writes join this
 * transaction instead of opening their own and committing.
 */
export async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

/**
 * Runs `fn` in a savepoint and reports whether it threw.
 *
 * Needed because a failed statement poisons the whole Postgres transaction:
 * without a savepoint, the first expected failure would make every later
 * assertion in the same test fail for an unrelated reason. (That mistake
 * silently turned six assertions green during an earlier manual check.)
 */
export async function expectFailure(
  tx: Tx,
  fn: (sp: Tx) => Promise<unknown>,
): Promise<{ threw: boolean; message: string }> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return { threw: false, message: "" };
  } catch (error) {
    return { threw: true, message: fullMessage(error) };
  }
}

/**
 * Flattens an error and its `cause` chain into one string.
 *
 * Drizzle wraps driver errors in its own "Failed query: ..." Error and hangs
 * the original underneath as `cause`. Reading only `.message` therefore shows
 * the SQL that failed but not WHY — the constraint name and the RAISE text,
 * which is the whole thing these tests are asserting on.
 */
function fullMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  if (parts.length === 0) parts.push(String(error));
  return parts.join(" | ");
}

let counter = 0;
/** Unique-per-run suffix, so a rolled-back run never collides with a live row. */
export function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter}`;
}

/**
 * A job card covering one item — card row plus its `job_card_item` (J25).
 *
 * Almost every test wants exactly this, and writing the two inserts by hand at
 * every call site is how half of them end up with a card covering nothing.
 */
export async function makeCardFor(
  tx: Tx,
  poItemId: string,
  card: Record<string, unknown> = {},
  plannedQty: number | null = null,
) {
  const row = await auditedInsert(
    SYSTEM_ACTOR,
    jobCard,
    { jcNo: await allocateNumber(tx, "JC", "2026-09-01"), ...card } as never,
    tx,
  );

  await auditedInsert(SYSTEM_ACTOR, jobCardItem, { jobCardId: row.id, poItemId, plannedQty }, tx);

  return row;
}
