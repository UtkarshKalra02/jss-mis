import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { baseColumns } from "./_shared";
import { delegationLevelEnum, delegationStatusEnum } from "./enums";
import { appUser } from "./users";

/* -------------------------------------------------------------------------- */
/* delegation_task                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A ONE-TIME task somebody has been asked to do by a date (BMP week 9).
 *
 * This is a weekly accountability layer, not a to-do list. Its whole output is
 * a per-person on-time score that gets read aloud in the executive meeting, and
 * every design choice below exists to keep that number honest.
 *
 * THERE IS DELIBERATELY NO RECURRENCE FIELD, and this is not an omission to be
 * fixed later (decision G5). Recurring work belongs on a checklist, which is a
 * different instrument. A repeating task here either scores once — making the
 * repetition pointless — or scores every occurrence, drowning genuine one-time
 * commitments under routine ticks. Either way the number stops meaning what the
 * meeting thinks it means.
 *
 * WHAT IS NOT STORED. days_late and is_overdue are computed in
 * v_delegation_status and exist nowhere else, for the same reason pending_qty
 * is (non-negotiable 2): a stored "days late" is a number that was true once.
 *
 * WHO MAY CHANGE WHAT is the point of the module and is enforced in three
 * places, deliberately:
 *
 *   - the CHECK constraints below, which the database applies to every writer
 *     including a psql session;
 *   - src/modules/delegation/permissions.ts, a pure function that decides which
 *     fields an actor may touch;
 *   - the audit wrapper, which carries the one narrow exception to the OWNER
 *     deny-write rule (decision G2).
 */
export const delegationTask = pgTable(
  "delegation_task",
  {
    ...baseColumns(),

    /** The person accountable. Changing this is a reassignment — see G4. */
    assignedTo: uuid()
      .notNull()
      .references(() => appUser.id),

    /**
     * The person who delegated it, and the only one besides ADMIN who may
     * change the task text, the expected date, or cancel it.
     *
     * That separation is the whole reason the score means anything: somebody
     * who can move their own deadline has not been held to one.
     */
    assignedBy: uuid()
      .notNull()
      .references(() => appUser.id),

    task: text().notNull(),

    level: delegationLevelEnum().notNull().default("L2"),

    /** Defaults in the DATABASE to today in IST, so a psql insert is right too. */
    dateGiven: date()
      .notNull()
      .default(sql`today_ist()`),

    /**
     * NOT NULL, and that is the rule rather than a convenience: a task without
     * a date is not a delegated task, it is a wish. Nothing in this module can
     * produce a row without one.
     */
    expectedDate: date().notNull(),

    status: delegationStatusEnum().notNull().default("Not Started"),

    /** The date the work was actually finished — not when it was ticked off. */
    completedAt: date(),

    blockerNote: text(),
  },
  (t) => [
    index("delegation_task_assigned_to_idx").on(t.assignedTo),
    index("delegation_task_assigned_by_idx").on(t.assignedBy),
    index("delegation_task_expected_date_idx").on(t.expectedDate),
    index("delegation_task_status_idx").on(t.status),

    /**
     * Done requires a completion date. Without it days_late has nothing to
     * measure against and the task would count as finished at no cost.
     */
    check(
      "delegation_done_needs_completed_at",
      sql`${t.status} <> 'Done' OR ${t.completedAt} IS NOT NULL`,
    ),

    /**
     * Blocked requires saying WHAT is blocking. "Blocked" with no note is how a
     * task stops being anybody's problem — it reads as a reason at a glance and
     * carries no information at all.
     */
    check(
      "delegation_blocked_needs_note",
      sql`${t.status} <> 'Blocked' OR (${t.blockerNote} IS NOT NULL AND length(trim(${t.blockerNote})) > 0)`,
    ),

    /**
     * A completion date only exists on a completed task.
     *
     * Not tidiness: v_delegation_status reads completed_at FIRST when working
     * out days_late, so a completion date left behind on a task that was moved
     * back to In Progress would freeze its lateness at the old value. Moving a
     * task off Done therefore has to clear the date, and this makes forgetting
     * an error rather than a quietly wrong score.
     */
    check(
      "delegation_completed_at_only_when_done",
      sql`${t.completedAt} IS NULL OR ${t.status} = 'Done'`,
    ),

    /** A task cannot be delegated to be finished before it was given. */
    check("delegation_expected_after_given", sql`${t.expectedDate} >= ${t.dateGiven}`),
  ],
);

export type DelegationTask = typeof delegationTask.$inferSelect;
export type NewDelegationTask = typeof delegationTask.$inferInsert;
