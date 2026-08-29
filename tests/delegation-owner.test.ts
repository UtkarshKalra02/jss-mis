import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditedInsert,
  auditedRestore,
  auditedSoftDelete,
  auditedUpdate,
  ReadOnlyRoleError,
  SYSTEM_ACTOR,
  type Actor,
  type Tx,
} from "@/db/audit";
import { client, delegationTask } from "@/db/schema";

import { inRollback, uniq } from "./helpers";

/**
 * THE ONE EXCEPTION TO B2 — decision G2.
 *
 * OWNER is globally deny-write, enforced in the audit wrapper. Amit is OWNER
 * and belongs on the delegation scorecard, which means he must be able to mark
 * his own tasks done. The exception granted is deliberately tiny: UPDATE only,
 * on delegation_task only, on rows already assigned to him, touching only
 * status / completed_at / blocker_note.
 *
 * THIS FILE IS WHAT MAKES THAT NARROW IN FACT RATHER THAN IN INTENT. Widening
 * SELF_WRITABLE_FIELDS is a two-word edit that will look innocuous a year from
 * now; every negative test below is here so that edit fails loudly instead.
 */

async function makeUser(tx: Tx, role: "OWNER" | "ADMIN" | "PLANNER"): Promise<string> {
  const username = uniq("own");
  const [row] = (
    await tx.execute(
      sql`insert into app_user (username, name, role) values (${username}, ${username}, ${role}) returning id`,
    )
  ).rows as { id: string }[];
  return row!.id;
}

async function taskFor(tx: Tx, assignedTo: string, assignedBy: string) {
  return auditedInsert(
    SYSTEM_ACTOR,
    delegationTask,
    {
      assignedTo,
      assignedBy,
      task: "Owner exception test",
      expectedDate: "2030-01-01",
    },
    tx,
  );
}

/** Runs `fn` in a savepoint, reporting whether it threw ReadOnlyRoleError. */
async function expectDenied(tx: Tx, fn: (sp: Tx) => Promise<unknown>) {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return { denied: false, name: "" };
  } catch (error) {
    return {
      denied: error instanceof ReadOnlyRoleError,
      name: error instanceof Error ? error.name : String(error),
    };
  }
}

describe("OWNER may update their OWN delegation task (G2)", () => {
  it("marks it done, with a completion date", async () => {
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };

      const task = await taskFor(tx, amit, boss);

      await auditedUpdate(
        owner,
        delegationTask,
        task.id,
        { status: "Done", completedAt: "2029-12-30" },
        tx,
      );

      const [row] = await tx
        .select()
        .from(delegationTask)
        .where(eq(delegationTask.id, task.id));

      expect(row!.status).toBe("Done");
      expect(row!.completedAt).toBe("2029-12-30");
    });
  });

  it("records a blocker note", async () => {
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };
      const task = await taskFor(tx, amit, boss);

      await auditedUpdate(
        owner,
        delegationTask,
        task.id,
        { status: "Blocked", blockerNote: "Waiting on the bank" },
        tx,
      );

      const [row] = await tx
        .select()
        .from(delegationTask)
        .where(eq(delegationTask.id, task.id));
      expect(row!.status).toBe("Blocked");
    });
  });

  it("still writes an audit row, attributed to him", async () => {
    // The exception permits the write; it does not exempt it from the log.
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };
      const task = await taskFor(tx, amit, boss);

      await auditedUpdate(owner, delegationTask, task.id, { status: "In Progress" }, tx);

      const rows = (
        await tx.execute(sql`
          select changed_by::text as changed_by
          from audit_log
          where table_name = 'delegation_task' and record_id = ${task.id}
            and action = 'UPDATE'
        `)
      ).rows as { changed_by: string }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.changed_by).toBe(amit);
    });
  });
});

describe("OWNER may do nothing else — the boundary of G2", () => {
  it("cannot change the EXPECTED DATE, even on his own task", async () => {
    // The whole point. The one person nobody overrules still cannot move his
    // own deadline, so his score means what everybody else's does.
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };
      const task = await taskFor(tx, amit, boss);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(owner, delegationTask, task.id, { expectedDate: "2031-01-01" }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot reword his own task", async () => {
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };
      const task = await taskFor(tx, amit, boss);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(owner, delegationTask, task.id, { task: "Something easier" }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot hand his own task to somebody else", async () => {
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };
      const task = await taskFor(tx, amit, boss);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(owner, delegationTask, task.id, { assignedTo: boss }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot sneak a forbidden field in alongside an allowed one", async () => {
    // A per-field check that passed on ANY allowed field would let this
    // through. Every key has to be on the list, not just one of them.
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };
      const task = await taskFor(tx, amit, boss);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(
          owner,
          delegationTask,
          task.id,
          { status: "In Progress", expectedDate: "2031-01-01" },
          sp,
        ),
      );

      expect(result.denied).toBe(true);

      const [row] = await tx
        .select()
        .from(delegationTask)
        .where(eq(delegationTask.id, task.id));
      // And nothing landed — not even the half that was allowed.
      expect(row!.status).toBe("Not Started");
      expect(row!.expectedDate).toBe("2030-01-01");
    });
  });

  it("cannot touch SOMEBODY ELSE'S delegation task", async () => {
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const preeti = await makeUser(tx, "PLANNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };

      const task = await taskFor(tx, preeti, boss);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(owner, delegationTask, task.id, { status: "Done" }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot CREATE a delegation task, even for himself", async () => {
    // The exception is an UPDATE. He does not author his own accountability.
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const owner: Actor = { id: amit, role: "OWNER" };

      const result = await expectDenied(tx, (sp) =>
        auditedInsert(
          owner,
          delegationTask,
          {
            assignedTo: amit,
            assignedBy: amit,
            task: "A task I set myself",
            expectedDate: "2030-01-01",
          },
          sp,
        ),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot delete or restore a delegation task", async () => {
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const boss = await makeUser(tx, "ADMIN");
      const owner: Actor = { id: amit, role: "OWNER" };
      const task = await taskFor(tx, amit, boss);

      const deleted = await expectDenied(tx, (sp) =>
        auditedSoftDelete(owner, delegationTask, task.id, sp),
      );
      expect(deleted.denied).toBe(true);

      const restored = await expectDenied(tx, (sp) =>
        auditedRestore(owner, delegationTask, task.id, sp),
      );
      expect(restored.denied).toBe(true);
    });
  });

  it("cannot write ANY OTHER TABLE — B2 is otherwise untouched", async () => {
    await inRollback(async (tx) => {
      const amit = await makeUser(tx, "OWNER");
      const owner: Actor = { id: amit, role: "OWNER" };

      const inserted = await expectDenied(tx, (sp) =>
        auditedInsert(owner, client, { code: uniq("O"), name: "Owner Co" }, sp),
      );
      expect(inserted.denied).toBe(true);

      // And an UPDATE on another table, which is the path carrying the
      // exception — the table check has to hold, not just the role check.
      const existing = await auditedInsert(
        SYSTEM_ACTOR,
        client,
        { code: uniq("O"), name: "Owner Co 2" },
        tx,
      );

      const updated = await expectDenied(tx, (sp) =>
        auditedUpdate(owner, client, existing.id, { name: "Renamed by owner" }, sp),
      );
      expect(updated.denied).toBe(true);
    });
  });
});
