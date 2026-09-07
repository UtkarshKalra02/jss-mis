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

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * THE ONE EXCEPTION TO B2 — decisions G2 and J26.
 *
 * OWNER is globally deny-write, enforced in the audit wrapper. G2 granted a tiny
 * exception so Amit could mark his OWN tasks done. J26 turned it round: he
 * delegates to anyone, nobody delegates to him, and he owns what he asked for
 * rather than reporting on it.
 *
 * THIS FILE IS WHAT MAKES THAT NARROW IN FACT RATHER THAN IN INTENT. Adding a
 * word to SELF_WRITABLE_FIELDS or DELEGATOR_WRITABLE_FIELDS is an edit that will
 * look innocuous a year from now; every negative test below is here so that edit
 * fails loudly instead.
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

/**
 * A task assigned TO the owner — impossible to create since J26, so the trigger
 * is dropped for the length of the savepoint.
 *
 * This is not a way round the rule, it is the only way to build a row that
 * PREDATES it. The self-write branch in the audit wrapper exists for exactly
 * those rows, and a branch with no test is a branch that quietly rots.
 */
async function legacyTaskForOwner(tx: Tx, ownerId: string, byId: string) {
  await tx.execute(
    sql`alter table delegation_task disable trigger delegation_task_no_owner_assignee_trg`,
  );
  const row = await taskFor(tx, ownerId, byId);
  await tx.execute(
    sql`alter table delegation_task enable trigger delegation_task_no_owner_assignee_trg`,
  );
  return row;
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

describe("an OWNER delegates (J26)", () => {
  it("raises a task for somebody else", async () => {
    // The half J26 added. He is the person work flows FROM.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const planner = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const row = await auditedInsert(
        actor,
        delegationTask,
        {
          assignedTo: planner,
          assignedBy: owner,
          task: "Re-quote the Nature carton",
          expectedDate: "2030-01-01",
        },
        tx,
      );

      expect(row.assignedTo).toBe(planner);
      expect(row.assignedBy).toBe(owner);
    });
  });

  it("cannot raise one for HIMSELF", async () => {
    // The half of G2 that J26 keeps: the one person who cannot be overruled
    // does not get to author his own accountability.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const result = await expectDenied(tx, (sp) =>
        auditedInsert(
          actor,
          delegationTask,
          {
            assignedTo: owner,
            assignedBy: owner,
            task: "Mark my own homework",
            expectedDate: "2030-01-01",
          },
          sp,
        ),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot insert into any OTHER table, which is still all of them", async () => {
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const result = await expectDenied(tx, (sp) =>
        auditedInsert(actor, client, { code: uniq("OW"), name: "Nope" }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });
});

describe("nobody delegates to an OWNER (J26)", () => {
  it("is refused by the DATABASE, not merely by the form", async () => {
    // Even for SYSTEM_ACTOR, which is an ADMIN and bypasses every application
    // rule. That is the whole point of putting it in a trigger
    // (non-negotiable 4): the form's rule is a rule until somebody writes a
    // script.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const admin = await makeUser(tx, "ADMIN");

      const result = await expectFailure(tx, (sp) => taskFor(sp, owner, admin));

      expect(result.threw).toBe(true);
      expect(result.message).toContain("delegation runs downwards");
    });
  });

  it("cannot be reached by REASSIGNING an existing task onto him", async () => {
    // The back door a create-only check would have left standing.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const admin = await makeUser(tx, "ADMIN");
      const planner = await makeUser(tx, "PLANNER");

      const task = await taskFor(tx, planner, admin);

      const result = await expectFailure(tx, (sp) =>
        auditedUpdate(SYSTEM_ACTOR, delegationTask, task.id, { assignedTo: owner }, sp),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("delegation runs downwards");
    });
  });
});

describe("an OWNER owns what he asked for, and does not report on it", () => {
  it("changes the task, the date and the level on a task HE raised", async () => {
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const planner = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await taskFor(tx, planner, owner);

      await auditedUpdate(
        actor,
        delegationTask,
        task.id,
        { task: "Re-quote it by Friday", expectedDate: "2030-02-01", level: "L3" },
        tx,
      );

      const [row] = await tx.select().from(delegationTask).where(eq(delegationTask.id, task.id));
      expect(row!.task).toBe("Re-quote it by Friday");
      expect(row!.expectedDate).toBe("2030-02-01");
      expect(row!.level).toBe("L3");
    });
  });

  it("cancels a task he raised", async () => {
    // Cancelling is a delegator action, never an assignee one (G3).
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const planner = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await taskFor(tx, planner, owner);
      await auditedUpdate(actor, delegationTask, task.id, { status: "Cancelled" }, tx);

      const [row] = await tx.select().from(delegationTask).where(eq(delegationTask.id, task.id));
      expect(row!.status).toBe("Cancelled");
    });
  });

  it("cannot mark somebody else's work DONE on his behalf", async () => {
    // completed_at and blocker_note belong to the person doing the work. A
    // delegator who can close his own task is a scorecard that measures nothing.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const planner = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await taskFor(tx, planner, owner);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(actor, delegationTask, task.id, { completedAt: "2030-01-02" }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot hand a task he raised to somebody else", async () => {
    // assigned_to is in NEITHER list. Reassignment stays an ADMIN action.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const planner = await makeUser(tx, "PLANNER");
      const other = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await taskFor(tx, planner, owner);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(actor, delegationTask, task.id, { assignedTo: other }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot touch a task somebody ELSE raised for somebody else", async () => {
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const admin = await makeUser(tx, "ADMIN");
      const planner = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await taskFor(tx, planner, admin);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(actor, delegationTask, task.id, { status: "Cancelled" }, sp),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot sneak a forbidden field in alongside an allowed one", async () => {
    // Every field or none. A single disallowed key refuses the whole update
    // rather than silently dropping it.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const planner = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await taskFor(tx, planner, owner);

      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(
          actor,
          delegationTask,
          task.id,
          { task: "Fine", blockerNote: "not fine" },
          sp,
        ),
      );

      expect(result.denied).toBe(true);
    });
  });

  it("cannot delete or restore a delegation task", async () => {
    // A delegated task is cancelled by status, not deleted.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const planner = await makeUser(tx, "PLANNER");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await taskFor(tx, planner, owner);

      expect(
        (await expectDenied(tx, (sp) => auditedSoftDelete(actor, delegationTask, task.id, sp)))
          .denied,
      ).toBe(true);

      expect(
        (await expectDenied(tx, (sp) => auditedRestore(actor, delegationTask, task.id, sp))).denied,
      ).toBe(true);
    });
  });
});

describe("a task assigned to him from BEFORE J26 still works", () => {
  it("lets him report on it, and still not move the goalposts", async () => {
    // The self-write branch G2 added. No new row can reach this state, but the
    // ones already in the database must not become unusable.
    await inRollback(async (tx) => {
      const owner = await makeUser(tx, "OWNER");
      const admin = await makeUser(tx, "ADMIN");
      const actor: Actor = { id: owner, role: "OWNER" };

      const task = await legacyTaskForOwner(tx, owner, admin);

      // Both together: a check constraint refuses Done with no completion date.
      await auditedUpdate(
        actor,
        delegationTask,
        task.id,
        { status: "Done", completedAt: "2030-01-02" },
        tx,
      );

      const [row] = await tx.select().from(delegationTask).where(eq(delegationTask.id, task.id));
      expect(row!.status).toBe("Done");

      // And still cannot move his own deadline.
      const result = await expectDenied(tx, (sp) =>
        auditedUpdate(actor, delegationTask, task.id, { expectedDate: "2031-01-01" }, sp),
      );
      expect(result.denied).toBe(true);
    });
  });
});
