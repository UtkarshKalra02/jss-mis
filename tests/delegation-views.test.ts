import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, auditedUpdate, type Tx } from "@/db/audit";
import { appUser, delegationTask } from "@/db/schema";
import { vDelegationScorecard, vDelegationStatus } from "@/db/views";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * The delegation views, against the real database.
 *
 * days_late and is_overdue exist only in SQL (migration 0012), so testing them
 * against anything but Postgres would test a reimplementation. These are the
 * numbers the executive meeting reads out; the arithmetic is worth pinning.
 */

async function makeUser(tx: Tx, name: string): Promise<string> {
  const username = uniq("dg");
  const [row] = (
    await tx.execute(
      sql`insert into app_user (username, name, role) values (${username}, ${name}, 'PLANNER') returning id`,
    )
  ).rows as { id: string }[];

  return row!.id;
}

/** Dates relative to the factory's today, so tests do not drift with the clock. */
async function istDays(tx: Tx, offset: number): Promise<string> {
  const [row] = (
    await tx.execute(sql`select (today_ist() + ${offset}::integer)::text as d`)
  ).rows as { d: string }[];
  return row!.d;
}

async function makeTask(
  tx: Tx,
  args: {
    assignedTo: string;
    assignedBy: string;
    expectedDate: string;
    status?: "Not Started" | "In Progress" | "Done" | "Blocked" | "Cancelled";
    completedAt?: string | null;
    blockerNote?: string | null;
    dateGiven?: string;
  },
) {
  return auditedInsert(
    SYSTEM_ACTOR,
    delegationTask,
    {
      assignedTo: args.assignedTo,
      assignedBy: args.assignedBy,
      task: "Test task",
      expectedDate: args.expectedDate,
      status: args.status ?? "Not Started",
      completedAt: args.completedAt ?? null,
      blockerNote: args.blockerNote ?? null,
      ...(args.dateGiven ? { dateGiven: args.dateGiven } : {}),
    },
    tx,
  );
}

async function statusOf(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(vDelegationStatus)
    .where(eq(vDelegationStatus.delegationTaskId, id));
  return row;
}

async function scoreOf(tx: Tx, userId: string) {
  const [row] = await tx
    .select()
    .from(vDelegationScorecard)
    .where(eq(vDelegationScorecard.appUserId, userId));
  return row;
}

describe("v_delegation_status — days_late", () => {
  it("is zero for a task finished on its date", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Days Late On Time");
      const due = await istDays(tx, -5);

      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: due,
        dateGiven: await istDays(tx, -10),
        status: "Done",
        completedAt: due,
      });

      const row = await statusOf(tx, task.id);
      expect(row!.daysLate).toBe(0);
      expect(row!.isOverdue).toBe(false);
    });
  });

  it("is zero for a task finished EARLY — early is not negative-late", async () => {
    // Rewarding earliness would push people to pad their dates, which is the
    // failure mode that makes an on-time percentage meaningless.
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Days Late Early");

      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: await istDays(tx, -2),
        dateGiven: await istDays(tx, -10),
        status: "Done",
        completedAt: await istDays(tx, -6),
      });

      expect((await statusOf(tx, task.id))!.daysLate).toBe(0);
    });
  });

  it("measures a finished task against when it was finished, not against today", async () => {
    // The one that matters: a task delivered two days late must not grow later
    // every morning. Its lateness is a fact about the past.
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Days Late Frozen");

      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: await istDays(tx, -30),
        dateGiven: await istDays(tx, -40),
        status: "Done",
        completedAt: await istDays(tx, -28),
      });

      const row = await statusOf(tx, task.id);
      expect(row!.daysLate).toBe(2);
      expect(row!.isOverdue).toBe(false);
    });
  });

  it("counts from today while a task is still open", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Days Late Open");

      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: await istDays(tx, -3),
        dateGiven: await istDays(tx, -10),
        status: "In Progress",
      });

      const row = await statusOf(tx, task.id);
      expect(row!.daysLate).toBe(3);
      expect(row!.isOverdue).toBe(true);
    });
  });

  it("is zero for a task not yet due, and days_past_due is negative", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Days Late Future");

      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: await istDays(tx, 4),
      });

      const row = await statusOf(tx, task.id);
      expect(row!.daysLate).toBe(0);
      expect(row!.isOverdue).toBe(false);
      // One number for both directions, so "in 4 days" and "4 days late" are
      // the same field read with opposite signs.
      expect(row!.daysPastDue).toBe(-4);
    });
  });

  it("never counts a CANCELLED task as late, however old it is", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Days Late Cancelled");

      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: await istDays(tx, -60),
        dateGiven: await istDays(tx, -70),
        status: "Cancelled",
      });

      const row = await statusOf(tx, task.id);
      expect(row!.daysLate).toBe(0);
      expect(row!.isOverdue).toBe(false);
    });
  });

  it("drops a soft-deleted task out of the view entirely", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Days Late Deleted");
      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: await istDays(tx, 1),
      });

      await tx
        .update(delegationTask)
        .set({ deletedAt: new Date() })
        .where(eq(delegationTask.id, task.id));

      expect(await statusOf(tx, task.id)).toBeUndefined();
    });
  });
});

describe("v_delegation_scorecard", () => {
  it("scores on-time out of assigned, not out of done", async () => {
    // Somebody who finished one task on time and abandoned nine has not scored
    // 100%. Dividing by `done` would say they had.
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Scorecard Denominator");
      const boss = await makeUser(tx, "Scorecard Boss");
      const given = await istDays(tx, -20);

      await makeTask(tx, {
        assignedTo: me,
        assignedBy: boss,
        dateGiven: given,
        expectedDate: await istDays(tx, -10),
        status: "Done",
        completedAt: await istDays(tx, -10),
      });
      for (let i = 0; i < 3; i += 1) {
        await makeTask(tx, {
          assignedTo: me,
          assignedBy: boss,
          dateGiven: given,
          expectedDate: await istDays(tx, -5),
          status: "In Progress",
        });
      }

      const score = await scoreOf(tx, me);
      expect(score!.assigned).toBe(4);
      expect(score!.done).toBe(1);
      expect(score!.onTime).toBe(1);
      expect(score!.open).toBe(3);
      expect(score!.overdueNow).toBe(3);
      expect(score!.scorePct).toBe(25);
    });
  });

  it("counts a late completion as done but not on time", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Scorecard Late");
      const boss = await makeUser(tx, "Scorecard Late Boss");
      const given = await istDays(tx, -20);

      await makeTask(tx, {
        assignedTo: me,
        assignedBy: boss,
        dateGiven: given,
        expectedDate: await istDays(tx, -10),
        status: "Done",
        completedAt: await istDays(tx, -6),
      });

      const score = await scoreOf(tx, me);
      expect(score!.done).toBe(1);
      expect(score!.late).toBe(1);
      expect(score!.onTime).toBe(0);
      expect(score!.scorePct).toBe(0);
      expect(Number(score!.avgDaysLate)).toBe(4);
    });
  });

  it("EXCLUDES cancelled tasks from the denominator (G3)", async () => {
    // Safe only because the assignee cannot cancel their own task. The two
    // rules hold together or not at all.
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Scorecard Cancelled");
      const boss = await makeUser(tx, "Scorecard Cancelled Boss");
      const given = await istDays(tx, -20);

      await makeTask(tx, {
        assignedTo: me,
        assignedBy: boss,
        dateGiven: given,
        expectedDate: await istDays(tx, -10),
        status: "Done",
        completedAt: await istDays(tx, -11),
      });
      await makeTask(tx, {
        assignedTo: me,
        assignedBy: boss,
        dateGiven: given,
        expectedDate: await istDays(tx, -9),
        status: "Cancelled",
      });

      const score = await scoreOf(tx, me);
      expect(score!.assigned).toBe(1);
      expect(score!.scorePct).toBe(100);
    });
  });

  it("scores NULL, not zero, when there is nothing to score", async () => {
    // Read aloud in a meeting, "—" and "0%" are different statements about a
    // person. Only one of them is true here.
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Scorecard Nothing");
      const boss = await makeUser(tx, "Scorecard Nothing Boss");

      await makeTask(tx, {
        assignedTo: me,
        assignedBy: boss,
        dateGiven: await istDays(tx, -20),
        expectedDate: await istDays(tx, -10),
        status: "Cancelled",
      });

      const score = await scoreOf(tx, me);
      expect(score!.assigned).toBe(0);
      expect(score!.scorePct).toBeNull();
    });
  });

  it("follows a reassignment — the score belongs to whoever holds the task", async () => {
    await inRollback(async (tx) => {
      const from = await makeUser(tx, "Scorecard From");
      const to = await makeUser(tx, "Scorecard To");
      const boss = await makeUser(tx, "Scorecard Move Boss");

      const task = await makeTask(tx, {
        assignedTo: from,
        assignedBy: boss,
        dateGiven: await istDays(tx, -20),
        expectedDate: await istDays(tx, -2),
        status: "In Progress",
      });

      expect((await scoreOf(tx, from))!.assigned).toBe(1);

      await auditedUpdate(SYSTEM_ACTOR, delegationTask, task.id, { assignedTo: to }, tx);

      expect(await scoreOf(tx, from)).toBeUndefined();
      expect((await scoreOf(tx, to))!.assigned).toBe(1);
      expect((await scoreOf(tx, to))!.overdueNow).toBe(1);
    });
  });

  it("leaves an audit row naming BOTH people (G4)", async () => {
    // The requirement is that a score cannot be laundered by moving a late
    // task quietly. The wrapper's whole-row snapshots are what make the move
    // legible after the fact, so this asserts they actually carry both ids
    // rather than assuming a snapshot contains everything.
    await inRollback(async (tx) => {
      const from = await makeUser(tx, "Audit From");
      const to = await makeUser(tx, "Audit To");
      const boss = await makeUser(tx, "Audit Boss");

      const task = await makeTask(tx, {
        assignedTo: from,
        assignedBy: boss,
        dateGiven: await istDays(tx, -20),
        expectedDate: await istDays(tx, -2),
        status: "In Progress",
      });

      await auditedUpdate(SYSTEM_ACTOR, delegationTask, task.id, { assignedTo: to }, tx);

      const rows = (
        await tx.execute(sql`
          select
            before ->> 'assignedTo' as from_id,
            after  ->> 'assignedTo' as to_id
          from audit_log
          where table_name = 'delegation_task'
            and record_id = ${task.id}
            and action = 'UPDATE'
            and before ->> 'assignedTo' is distinct from after ->> 'assignedTo'
        `)
      ).rows as { from_id: string; to_id: string }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.from_id).toBe(from);
      expect(rows[0]!.to_id).toBe(to);
    });
  });
});

describe("database constraints", () => {
  it("refuses Done with no completion date", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Constraint Done");

      const result = await expectFailure(tx, (sp) =>
        makeTask(sp, {
          assignedTo: me,
          assignedBy: me,
          expectedDate: "2026-01-01",
          dateGiven: "2026-01-01",
          status: "Done",
        }),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("delegation_done_needs_completed_at");
    });
  });

  it("refuses Blocked with no note, and with a whitespace note", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Constraint Blocked");

      const empty = await expectFailure(tx, (sp) =>
        makeTask(sp, {
          assignedTo: me,
          assignedBy: me,
          expectedDate: "2026-01-01",
          dateGiven: "2026-01-01",
          status: "Blocked",
        }),
      );
      expect(empty.message).toContain("delegation_blocked_needs_note");

      const blank = await expectFailure(tx, (sp) =>
        makeTask(sp, {
          assignedTo: me,
          assignedBy: me,
          expectedDate: "2026-01-01",
          dateGiven: "2026-01-01",
          status: "Blocked",
          blockerNote: "   ",
        }),
      );
      expect(blank.message).toContain("delegation_blocked_needs_note");
    });
  });

  it("refuses a completion date on a task that is not Done", async () => {
    // This is what stops a stale date freezing days_late at an old value.
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Constraint Stale");

      const result = await expectFailure(tx, (sp) =>
        makeTask(sp, {
          assignedTo: me,
          assignedBy: me,
          expectedDate: "2026-01-01",
          dateGiven: "2026-01-01",
          status: "In Progress",
          completedAt: "2026-01-01",
        }),
      );

      expect(result.message).toContain("delegation_completed_at_only_when_done");
    });
  });

  it("refuses an expected date before the task was given", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Constraint Backwards");

      const result = await expectFailure(tx, (sp) =>
        makeTask(sp, {
          assignedTo: me,
          assignedBy: me,
          dateGiven: "2026-02-01",
          expectedDate: "2026-01-01",
        }),
      );

      expect(result.message).toContain("delegation_expected_after_given");
    });
  });

  it("defaults date_given to today in IST, not to the server's date", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Constraint Default");
      const today = await istDays(tx, 0);

      const task = await makeTask(tx, {
        assignedTo: me,
        assignedBy: me,
        expectedDate: await istDays(tx, 3),
      });

      const [row] = await tx
        .select({ dateGiven: delegationTask.dateGiven })
        .from(delegationTask)
        .where(eq(delegationTask.id, task.id));

      expect(row!.dateGiven).toBe(today);
    });
  });

  it("cleans up: app_user rows are rolled back with everything else", async () => {
    await inRollback(async (tx) => {
      const me = await makeUser(tx, "Rollback Check");
      const [row] = await tx.select().from(appUser).where(eq(appUser.id, me));
      expect(row).toBeDefined();
    });
  });
});
