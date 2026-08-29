import { and, asc, count, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { SYSTEM_USER_ID, type Tx } from "@/db/audit";
import { db } from "@/db";
import { appUser, delegationTask } from "@/db/schema";
import { vDelegationScorecard, vDelegationStatus } from "@/db/views";

/**
 * Reads for the Delegation module.
 *
 * Everything that involves lateness goes through v_delegation_status rather
 * than computing it here. days_late has one definition (migration 0012) and
 * this is the file most likely to grow a second one — "it is just a date
 * subtraction" is exactly how the task list and the meeting scorecard end up
 * disagreeing out loud.
 */

/** Either the pool or an open transaction — see taskCountsFor. */
type Runner = typeof db | Tx;

export type TaskRow = typeof vDelegationStatus.$inferSelect;

/**
 * What is assigned to one person, soonest first.
 *
 * Sorted by expected_date ascending with overdue naturally at the top, then by
 * status so finished work sinks. Not `NULLS LAST` anywhere, unlike F23 — this
 * column is NOT NULL by design, because a task without a date is not a task.
 */
export async function myTasks(
  userId: string,
  options: { includeFinished?: boolean } = {},
): Promise<TaskRow[]> {
  return db
    .select()
    .from(vDelegationStatus)
    .where(
      options.includeFinished
        ? eq(vDelegationStatus.assignedTo, userId)
        : and(
            eq(vDelegationStatus.assignedTo, userId),
            // One negative list rather than two ne() terms ORed together: the
            // OR reads as "open" and is in fact always true, since no status is
            // both Done and Cancelled at once.
            sql`${vDelegationStatus.status} not in ('Done', 'Cancelled')`,
          ),
    )
    .orderBy(asc(vDelegationStatus.expectedDate), asc(vDelegationStatus.createdAt));
}

/** Everything this person has handed out, for the delegator's own view. */
export async function tasksIDelegated(userId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(vDelegationStatus)
    .where(
      and(
        eq(vDelegationStatus.assignedBy, userId),
        ne(vDelegationStatus.assignedTo, userId),
      ),
    )
    .orderBy(asc(vDelegationStatus.expectedDate), asc(vDelegationStatus.createdAt));
}

/**
 * One task as the detail screen sees it.
 *
 * Reads the VIEW, which excludes soft-deleted rows — so a removed task returns
 * null here and the page calls notFound(). A withdrawn (Cancelled) task is
 * still returned, because withdrawing is a state the task is in rather than the
 * task ceasing to exist. The difference is what decides whether the screen can
 * stay put after an action or has to go somewhere else (G11).
 */
export async function getTask(id: string, runner: Runner = db): Promise<TaskRow | null> {
  const [row] = await runner
    .select()
    .from(vDelegationStatus)
    .where(eq(vDelegationStatus.delegationTaskId, id))
    .limit(1);

  return row ?? null;
}

/**
 * The raw row, for writes.
 *
 * The view is the read model and deliberately excludes soft-deleted rows; an
 * action about to update something needs to know it exists at all.
 */
export async function getTaskRecord(id: string) {
  const [row] = await db
    .select()
    .from(delegationTask)
    .where(and(eq(delegationTask.id, id), isNull(delegationTask.deletedAt)))
    .limit(1);

  return row ?? null;
}

export type TaskCounts = {
  /** Not Started, In Progress or Blocked — everything still owed. */
  pending: number;
  /** The subset of those that are already past their date. */
  overdue: number;
};

/**
 * The two numbers the dashboard tile needs, in ONE query.
 *
 * Both come from v_delegation_status rather than being counted separately,
 * because `overdue` has to be a strict subset of `pending` — two queries
 * against a moving clock can straddle midnight IST and report three overdue out
 * of two pending, which is the kind of nonsense nobody reports and everybody
 * stops trusting.
 *
 * Takes an optional runner so it can be exercised inside a rolled-back
 * transaction, the same way findPurchaseOrder does.
 */
export async function taskCountsFor(userId: string, runner: Runner = db): Promise<TaskCounts> {
  const [row] = await runner
    .select({
      pending: count(),
      overdue: sql<number>`count(*) filter (where ${vDelegationStatus.isOverdue})::int`,
    })
    .from(vDelegationStatus)
    .where(
      and(
        eq(vDelegationStatus.assignedTo, userId),
        sql`${vDelegationStatus.status} not in ('Done', 'Cancelled')`,
      ),
    );

  return { pending: row?.pending ?? 0, overdue: row?.overdue ?? 0 };
}

export type ScorecardRow = typeof vDelegationScorecard.$inferSelect;

/**
 * The executive meeting screen's data.
 *
 * Ordered worst-score-first so the conversation starts where it needs to.
 * Nulls — people with nothing to score — sort last rather than reading as zero.
 */
export async function scorecard(): Promise<ScorecardRow[]> {
  return db
    .select()
    .from(vDelegationScorecard)
    .orderBy(sql`${vDelegationScorecard.scorePct} asc nulls last`, asc(vDelegationScorecard.name));
}

/**
 * Assignable people.
 *
 * SYSTEM is excluded for the same reason the user admin excludes it: it is a
 * machine account, and offering it in a "who is this for?" list invites
 * somebody to delegate a task to nobody. Inactive accounts are excluded too —
 * a task assigned to somebody who cannot sign in is a task nobody will do.
 */
export type Assignee = { id: string; name: string; username: string; role: string };

export async function assignableUsers(): Promise<Assignee[]> {
  return db
    .select({
      id: appUser.id,
      name: appUser.name,
      username: appUser.username,
      role: appUser.role,
    })
    .from(appUser)
    .where(
      and(ne(appUser.id, SYSTEM_USER_ID), eq(appUser.isActive, true), isNull(appUser.deletedAt)),
    )
    .orderBy(asc(appUser.name));
}

/**
 * The reassignment history of one task, read from the audit log.
 *
 * Decision G4 requires that moving a task shows BOTH people. The audit wrapper
 * already writes whole-row before/after snapshots, so this reads them back and
 * keeps only the writes where assigned_to actually changed — turning "diff two
 * JSON blobs" into a line somebody can read on the task screen.
 */
export type Reassignment = {
  at: Date;
  fromUserId: string | null;
  toUserId: string | null;
  byUserId: string | null;
};

export async function reassignmentsFor(taskId: string): Promise<Reassignment[]> {
  const rows = await db.execute<{
    changed_at: Date;
    from_id: string | null;
    to_id: string | null;
    changed_by: string | null;
  }>(sql`
    select
      changed_at,
      before ->> 'assignedTo' as from_id,
      after  ->> 'assignedTo' as to_id,
      changed_by
    from audit_log
    where table_name = 'delegation_task'
      and record_id = ${taskId}
      and action = 'UPDATE'
      and before ->> 'assignedTo' is distinct from after ->> 'assignedTo'
    order by changed_at desc
  `);

  return rows.rows.map((r) => ({
    at: r.changed_at,
    fromUserId: r.from_id,
    toUserId: r.to_id,
    byUserId: r.changed_by,
  }));
}

/** Names for the ids a reassignment row holds. */
export async function userNames(): Promise<Map<string, string>> {
  const rows = await db.select({ id: appUser.id, name: appUser.name }).from(appUser);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Most recently delegated first — the "what did I hand out" ordering. */
export async function recentlyDelegatedBy(userId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(vDelegationStatus)
    .where(eq(vDelegationStatus.assignedBy, userId))
    .orderBy(desc(vDelegationStatus.createdAt))
    .limit(50);
}
