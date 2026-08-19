import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditedAppend,
  auditedInsert,
  auditedRestore,
  auditedSoftDelete,
  auditedUpdate,
  ReadOnlyRoleError,
  RecordNotFoundError,
  SYSTEM_ACTOR,
  type Actor,
  type Tx,
} from "@/db/audit";
import {
  appUser,
  auditLog,
  client,
  poItem,
  purchaseOrder,
  stage,
  stageEvent,
} from "@/db/schema";

import { expectFailure, inRollback, uniq } from "./helpers";

const ADMIN: Actor = { id: SYSTEM_ACTOR.id, role: "ADMIN" };
const OWNER: Actor = { id: SYSTEM_ACTOR.id, role: "OWNER" };

async function auditRowsFor(tx: Tx, table: string, recordId: string) {
  return tx
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tableName, table), eq(auditLog.recordId, recordId)))
    .orderBy(desc(auditLog.changedAt));
}

describe("audit wrapper", () => {
  it("writes an INSERT audit row alongside the insert", async () => {
    await inRollback(async (tx) => {
      const row = await auditedInsert(
        ADMIN,
        client,
        { code: uniq("T"), name: "Audit Test Co" },
        tx,
      );

      const audits = await auditRowsFor(tx, "client", row.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.action).toBe("INSERT");
      expect(audits[0]!.before).toBeNull();
      expect((audits[0]!.after as Record<string, unknown>).name).toBe("Audit Test Co");
      expect(audits[0]!.changedBy).toBe(ADMIN.id);
    });
  });

  it("stamps created_by and updated_by from the actor", async () => {
    await inRollback(async (tx) => {
      const row = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "Stamp" }, tx);
      expect(row.createdBy).toBe(ADMIN.id);
      expect(row.updatedBy).toBe(ADMIN.id);
    });
  });

  it("records both before and after on update", async () => {
    await inRollback(async (tx) => {
      const row = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "Before" }, tx);
      await auditedUpdate(ADMIN, client, row.id, { name: "After" }, tx);

      const audits = await auditRowsFor(tx, "client", row.id);
      const update = audits.find((a) => a.action === "UPDATE");
      expect(update).toBeDefined();
      expect((update!.before as Record<string, unknown>).name).toBe("Before");
      expect((update!.after as Record<string, unknown>).name).toBe("After");
    });
  });

  it("soft deletes rather than removing the row", async () => {
    await inRollback(async (tx) => {
      const row = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "Gone" }, tx);
      const deleted = await auditedSoftDelete(ADMIN, client, row.id, tx);

      expect(deleted.deletedAt).toBeInstanceOf(Date);

      // The row is still there — that is the point of non-negotiable 7.
      const [stillPresent] = await tx.select().from(client).where(eq(client.id, row.id));
      expect(stillPresent).toBeDefined();

      const audits = await auditRowsFor(tx, "client", row.id);
      expect(audits.some((a) => a.action === "SOFT_DELETE")).toBe(true);
    });
  });

  it("restores a soft-deleted row as its own action", async () => {
    await inRollback(async (tx) => {
      const row = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "Back" }, tx);
      await auditedSoftDelete(ADMIN, client, row.id, tx);
      const restored = await auditedRestore(ADMIN, client, row.id, tx);

      expect(restored.deletedAt).toBeNull();
      const audits = await auditRowsFor(tx, "client", row.id);
      expect(audits.some((a) => a.action === "RESTORE")).toBe(true);
    });
  });

  it("refuses every write from an OWNER (B2)", async () => {
    await inRollback(async (tx) => {
      await expect(
        auditedInsert(OWNER, client, { code: uniq("T"), name: "Nope" }, tx),
      ).rejects.toBeInstanceOf(ReadOnlyRoleError);

      const existing = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "X" }, tx);

      await expect(
        auditedUpdate(OWNER, client, existing.id, { name: "Y" }, tx),
      ).rejects.toBeInstanceOf(ReadOnlyRoleError);

      await expect(auditedSoftDelete(OWNER, client, existing.id, tx)).rejects.toBeInstanceOf(
        ReadOnlyRoleError,
      );

      // The refused writes left nothing behind.
      const audits = await auditRowsFor(tx, "client", existing.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.action).toBe("INSERT");
    });
  });

  it("never puts a password hash in the audit log", async () => {
    await inRollback(async (tx) => {
      const user = await auditedInsert(
        ADMIN,
        appUser,
        {
          username: uniq("u"),
          name: "Hash Test",
          role: "FLOOR",
          passwordHash: "$2b$12$averysecrethashvaluethatmustnotleak",
        },
        tx,
      );

      const audits = await auditRowsFor(tx, "app_user", user.id);
      const after = audits[0]!.after as Record<string, unknown>;

      expect(after.passwordHash).toBe("[redacted]");
      expect(JSON.stringify(audits)).not.toContain("averysecrethash");
    });
  });

  it("keeps a null password hash distinguishable from a redacted one", async () => {
    await inRollback(async (tx) => {
      const user = await auditedInsert(
        ADMIN,
        appUser,
        { username: uniq("u"), name: "No Password", role: "FLOOR", passwordHash: null },
        tx,
      );

      const audits = await auditRowsFor(tx, "app_user", user.id);
      // null means "cannot sign in", which is information the log should keep.
      expect((audits[0]!.after as Record<string, unknown>).passwordHash).toBeNull();
    });
  });

  it("throws when the target row does not exist", async () => {
    await inRollback(async (tx) => {
      await expect(
        auditedUpdate(ADMIN, client, "00000000-0000-0000-0000-0000000000ff", { name: "x" }, tx),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
    });
  });

  it("rolls the mutation back when the audit row cannot be written", async () => {
    // The real guarantee behind non-negotiable 3: not "we also write a log",
    // but "the change cannot exist without the log".
    //
    // Forced by using an actor id that is not in app_user, so the audit row
    // violates its changed_by foreign key. If the two were not in one
    // transaction, the client row would survive the failed log write.
    await inRollback(async (tx) => {
      const ghost: Actor = { id: "00000000-0000-0000-0000-0000000000aa", role: "ADMIN" };
      const code = uniq("T");

      const result = await expectFailure(tx, (sp) =>
        auditedInsert(ghost, client, { code, name: "Should not survive" }, sp),
      );
      expect(result.threw).toBe(true);

      const rows = await tx.select().from(client).where(eq(client.code, code));
      expect(rows).toHaveLength(0);
    });
  });

  it("commits several writes together when handed one transaction", async () => {
    await inRollback(async (tx) => {
      const a = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "A" }, tx);
      const b = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "B" }, tx);

      expect(await auditRowsFor(tx, "client", a.id)).toHaveLength(1);
      expect(await auditRowsFor(tx, "client", b.id)).toHaveLength(1);
    });
  });
});

/**
 * A live PO item and a stage to move it to. Stage events are the only thing
 * auditedAppend is for, and they cannot exist without both.
 */
async function stageEventFixture(tx: Tx) {
  const stageCode = uniq("TST_").toUpperCase();
  await auditedInsert(
    ADMIN,
    stage,
    { code: stageCode, name: "Test Stage", sequence: 999, colour: "#000000" },
    tx,
  );

  const c = await auditedInsert(ADMIN, client, { code: uniq("T"), name: "Append Co" }, tx);

  const po = await auditedInsert(
    ADMIN,
    purchaseOrder,
    { internalNo: uniq("PO-"), clientId: c.id, poDate: "2026-08-18" },
    tx,
  );

  const item = await auditedInsert(
    ADMIN,
    poItem,
    {
      itemCode: uniq("ITM-"),
      purchaseOrderId: po.id,
      itemName: "Append item",
      orderedQty: 100,
      committedDate: "2026-09-01",
    },
    tx,
  );

  return { stageCode, itemId: item.id };
}

/**
 * auditedAppend (decision F1) — the write path for stage_event.
 *
 * Before it existed, the one table Phase 2 is built to write had no audited
 * path at all: it cannot satisfy AuditableTable, because it deliberately has
 * no updated_by or deleted_at (C6). These tests are about the hole being
 * closed, not about the insert working.
 */
describe("auditedAppend", () => {
  it("writes the event and its audit row together", async () => {
    await inRollback(async (tx) => {
      const f = await stageEventFixture(tx);

      const event = await auditedAppend(
        ADMIN,
        stageEvent,
        {
          poItemId: f.itemId,
          stageCode: f.stageCode,
          eventAt: new Date("2026-08-18T10:00:00Z"),
          remarks: "First event",
        },
        tx,
      );

      const audits = await auditRowsFor(tx, "stage_event", event.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.action).toBe("INSERT");
      expect(audits[0]!.before).toBeNull();
      expect((audits[0]!.after as Record<string, unknown>).remarks).toBe("First event");
      expect(audits[0]!.changedBy).toBe(ADMIN.id);
    });
  });

  it("stamps entered_by from the actor, overriding whatever the caller passed", async () => {
    await inRollback(async (tx) => {
      const f = await stageEventFixture(tx);

      const event = await auditedAppend(
        ADMIN,
        stageEvent,
        {
          poItemId: f.itemId,
          stageCode: f.stageCode,
          eventAt: new Date(),
          // Someone else's id. The person the audit row names and the person
          // the event names must not be able to disagree.
          enteredBy: "00000000-0000-0000-0000-0000000000ff",
        },
        tx,
      );

      expect(event.enteredBy).toBe(ADMIN.id);
    });
  });

  it("refuses an append from an OWNER (B2), leaving nothing behind", async () => {
    await inRollback(async (tx) => {
      const f = await stageEventFixture(tx);

      await expect(
        auditedAppend(
          OWNER,
          stageEvent,
          { poItemId: f.itemId, stageCode: f.stageCode, eventAt: new Date() },
          tx,
        ),
      ).rejects.toBeInstanceOf(ReadOnlyRoleError);

      const events = await tx
        .select()
        .from(stageEvent)
        .where(eq(stageEvent.poItemId, f.itemId));
      expect(events).toHaveLength(0);
    });
  });

  it("rolls the event back when its audit row cannot be written", async () => {
    // The same guarantee non-negotiable 3 makes for every other table: the
    // event cannot exist without its log entry. Forced with an actor id that
    // is not in app_user, so the audit row violates its changed_by foreign key.
    await inRollback(async (tx) => {
      const f = await stageEventFixture(tx);
      const ghost: Actor = { id: "00000000-0000-0000-0000-0000000000aa", role: "ADMIN" };

      const result = await expectFailure(tx, (sp) =>
        auditedAppend(
          ghost,
          stageEvent,
          { poItemId: f.itemId, stageCode: f.stageCode, eventAt: new Date() },
          sp,
        ),
      );
      expect(result.threw).toBe(true);

      const events = await tx
        .select()
        .from(stageEvent)
        .where(eq(stageEvent.poItemId, f.itemId));
      expect(events).toHaveLength(0);
    });
  });
});

/**
 * A compile-time assertion, not a runtime one.
 *
 * The two write paths must stay mutually exclusive: a business table can never
 * be appended to, and an append-only table can never be updated. That is what
 * keeps "corrections are made by appending" (C6) from being merely a
 * convention someone could forget.
 *
 * This function is never called. Its whole content is the two @ts-expect-error
 * directives, each of which FAILS THE BUILD if the call it precedes ever stops
 * being an error — so `npm run typecheck` enforces the boundary on every run.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _writePathsStayMutuallyExclusive() {
  // @ts-expect-error client is not append-only: it has no entered_by column.
  void auditedAppend(ADMIN, client, { code: "x", name: "y" });

  // @ts-expect-error stage_event cannot be updated: no updated_by, no deleted_at.
  void auditedUpdate(ADMIN, stageEvent, "id", {});
}

