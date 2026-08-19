import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { auditedAppend, auditedInsert, SYSTEM_ACTOR } from "@/db/audit";
import { auditLog, poItem, purchaseOrder, stageEvent } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";
import { startOfDayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import { inRollback, uniq } from "./helpers";

/**
 * Stage Update's write path — spec 6.7.
 *
 * The precedence rule that decides WHICH stages are offered is a pure function
 * and is tested without a database in tests/stage-precedence.test.ts. What is
 * checked here is what happens when a move is actually made: an event is
 * appended, the derived stage follows it, and the history is never rewritten.
 */

async function item(tx: Tx, opts: { committedDate?: string | null } = {}) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("SU")}, 'Stage Co') returning id`,
    )
  ).rows as { id: string }[];

  const po = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", "2026-08-01"),
      clientId: c!.id,
      poDate: "2026-08-01",
    },
    tx,
  );

  const row = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-08-01"),
      purchaseOrderId: po.id,
      itemName: "Stage item",
      orderedQty: 100,
      committedDate: opts.committedDate === undefined ? "2026-09-01" : opts.committedDate,
    },
    tx,
  );

  await auditedAppend(
    SYSTEM_ACTOR,
    stageEvent,
    { poItemId: row.id, stageCode: "PO_RECEIVED", eventAt: startOfDayIST("2026-08-01") },
    tx,
  );

  return row;
}

async function currentStage(tx: Tx, poItemId: string) {
  const [row] = await tx
    .select({
      currentStage: vPoItemStatus.currentStage,
      currentStageSince: vPoItemStatus.currentStageSince,
    })
    .from(vPoItemStatus)
    .where(eq(vPoItemStatus.poItemId, poItemId));
  return row!;
}

describe("stage update", () => {
  it("moves an item and the derived stage follows", async () => {
    await inRollback(async (tx) => {
      const it1 = await item(tx);
      const at = new Date("2026-08-19T10:30:00+05:30");

      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        { poItemId: it1.id, stageCode: "PRINTING", eventAt: at, remarks: "Started run" },
        tx,
      );

      const now = await currentStage(tx, it1.id);
      expect(now.currentStage).toBe("PRINTING");
      expect(now.currentStageSince!.toISOString()).toBe(at.toISOString());
    });
  });

  it("records a backward move as a new event, never by undoing the old one", async () => {
    // F4: rework is real. C6: corrections are appends. Together they mean the
    // timeline legitimately shows a job going backwards.
    await inRollback(async (tx) => {
      const it1 = await item(tx);

      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        { poItemId: it1.id, stageCode: "DIE_CUT", eventAt: new Date("2026-08-19T09:00:00+05:30") },
        tx,
      );
      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        {
          poItemId: it1.id,
          stageCode: "PRINTING",
          eventAt: new Date("2026-08-19T14:00:00+05:30"),
          remarks: "Reprint — colour off",
        },
        tx,
      );

      expect((await currentStage(tx, it1.id)).currentStage).toBe("PRINTING");

      // All three events survive. The die-cut still happened.
      const history = await tx
        .select({ stageCode: stageEvent.stageCode })
        .from(stageEvent)
        .where(eq(stageEvent.poItemId, it1.id))
        .orderBy(stageEvent.eventAt);

      expect(history.map((h) => h.stageCode)).toEqual([
        "PO_RECEIVED",
        "DIE_CUT",
        "PRINTING",
      ]);
    });
  });

  it("derives the stage from when work happened, not the order it was typed", async () => {
    // Ajay updates in batches, so the typing order carries no information.
    await inRollback(async (tx) => {
      const it1 = await item(tx);

      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        { poItemId: it1.id, stageCode: "DIE_CUT", eventAt: new Date("2026-08-19T16:00:00+05:30") },
        tx,
      );
      // Entered afterwards, but it happened in the morning.
      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        { poItemId: it1.id, stageCode: "PRINTING", eventAt: new Date("2026-08-19T08:00:00+05:30") },
        tx,
      );

      expect((await currentStage(tx, it1.id)).currentStage).toBe("DIE_CUT");
    });
  });

  it("audits every stage change (non-negotiable 3)", async () => {
    await inRollback(async (tx) => {
      const it1 = await item(tx);

      const event = await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        { poItemId: it1.id, stageCode: "READY", eventAt: new Date() },
        tx,
      );

      const rows = await tx
        .select({ action: auditLog.action, changedBy: auditLog.changedBy })
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "stage_event"), eq(auditLog.recordId, event.id)));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe("INSERT");
      expect(rows[0]!.changedBy).toBe(SYSTEM_ACTOR.id);
    });
  });

  it("commits a bulk move as one transaction or not at all", async () => {
    // Half-applying a bulk update leaves Preeti guessing which rows took.
    await inRollback(async (tx) => {
      const a = await item(tx);
      const b = await item(tx);

      let threw = false;
      try {
        await tx.transaction(async (sp) => {
          await auditedAppend(
            SYSTEM_ACTOR,
            stageEvent,
            { poItemId: a.id, stageCode: "PRINTING", eventAt: new Date() },
            sp,
          );
          // Violates the foreign key on stage.code.
          await auditedAppend(
            SYSTEM_ACTOR,
            stageEvent,
            { poItemId: b.id, stageCode: "NOT_A_STAGE", eventAt: new Date() },
            sp,
          );
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
      // The good one did not survive the bad one.
      expect((await currentStage(tx, a.id)).currentStage).toBe("PO_RECEIVED");
    });
  });

  it("shows items with no committed date without flagging them (F8)", async () => {
    // The grid sorts on committed date. A historical row has none and must
    // still appear — and must not be coloured as overdue or at risk.
    await inRollback(async (tx) => {
      const it1 = await item(tx, { committedDate: null });

      const [row] = await tx
        .select({
          pendingQty: vPoItemStatus.pendingQty,
          isOverdue: vPoItemStatus.isOverdue,
          isAtRisk: vPoItemStatus.isAtRisk,
          status: vPoItemStatus.status,
        })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, it1.id));

      expect(row!.status).toBe("Open");
      expect(row!.pendingQty).toBe(100);
      expect(row!.isOverdue).toBe(false);
      expect(row!.isAtRisk).toBe(false);
    });
  });
});
