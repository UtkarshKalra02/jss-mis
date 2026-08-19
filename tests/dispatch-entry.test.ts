import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { auditedAppend, auditedInsert, SYSTEM_ACTOR } from "@/db/audit";
import { dispatch, dispatchLine, poItem, purchaseOrder, stageEvent } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";
import { startOfDayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Dispatch entry — spec 6.8, Phase 2's entry-only half.
 *
 * The rule worth protecting is WHEN a DISPATCHED stage event is written: only
 * when the challan brings an item's pending quantity to zero. A partial
 * delivery must not move an item to DISPATCHED, or it drops off Stage Update
 * while work continues on the remainder.
 */

async function fixture(tx: Tx, orderedQty = 1000) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("D")}, 'Dispatch Co') returning id`,
    )
  ).rows as { id: string }[];

  const po = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    { internalNo: await allocateNumber(tx, "PO", "2026-08-01"), clientId: c!.id, poDate: "2026-08-01" },
    tx,
  );

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-08-01"),
      purchaseOrderId: po.id,
      itemName: "Dispatch item",
      orderedQty,
      committedDate: "2026-09-01",
    },
    tx,
  );

  await auditedAppend(
    SYSTEM_ACTOR,
    stageEvent,
    { poItemId: item.id, stageCode: "PO_RECEIVED", eventAt: startOfDayIST("2026-08-01") },
    tx,
  );

  return { clientId: c!.id, itemId: item.id };
}

/** Creates a challan and returns it. Mirrors what the action does. */
async function challan(
  tx: Tx,
  args: { clientId: string; dispatchDate: string; status?: "Draft" | "Dispatched" | "Cancelled" },
) {
  return auditedInsert(
    SYSTEM_ACTOR,
    dispatch,
    {
      challanNo: await allocateNumber(tx, "CH", args.dispatchDate),
      clientId: args.clientId,
      dispatchDate: args.dispatchDate,
      status: args.status ?? "Dispatched",
    },
    tx,
  );
}

/** The action's rule: complete, and not already at DISPATCHED. */
async function completedItems(tx: Tx, poItemIds: string[]): Promise<string[]> {
  const rows = await tx
    .select({
      poItemId: vPoItemStatus.poItemId,
      pendingQty: vPoItemStatus.pendingQty,
      currentStage: vPoItemStatus.currentStage,
    })
    .from(vPoItemStatus)
    .where(sql`${vPoItemStatus.poItemId} = any(${sql.param(poItemIds)}::uuid[])`);

  return rows
    .filter((r) => r.pendingQty <= 0 && r.currentStage !== "DISPATCHED")
    .map((r) => r.poItemId);
}

async function stagesOf(tx: Tx, poItemId: string): Promise<string[]> {
  const rows = await tx
    .select({ stageCode: stageEvent.stageCode })
    .from(stageEvent)
    .where(eq(stageEvent.poItemId, poItemId))
    .orderBy(stageEvent.eventAt);
  return rows.map((r) => r.stageCode);
}

describe("dispatch entry", () => {
  it("does not mark an item DISPATCHED on a partial delivery", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 1000);
      const ch = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-20" });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 400 },
        tx,
      );

      // 600 still owed — the item is still in production.
      expect(await completedItems(tx, [f.itemId])).toEqual([]);
      expect(await stagesOf(tx, f.itemId)).toEqual(["PO_RECEIVED"]);
    });
  });

  it("marks the item DISPATCHED when the last of the quantity goes out", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 1000);
      const ch = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-20" });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 400 },
        tx,
      );
      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 600 },
        tx,
      );

      const completed = await completedItems(tx, [f.itemId]);
      expect(completed).toEqual([f.itemId]);

      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        {
          poItemId: f.itemId,
          stageCode: "DISPATCHED",
          eventAt: startOfDayIST("2026-08-20"),
        },
        tx,
      );

      expect(await stagesOf(tx, f.itemId)).toEqual(["PO_RECEIVED", "DISPATCHED"]);

      // And the recompute trigger closed it (B5).
      const [row] = await tx
        .select({ status: vPoItemStatus.status, pendingQty: vPoItemStatus.pendingQty })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, f.itemId));
      expect(row!.pendingQty).toBe(0);
      expect(row!.status).toBe("Closed");
    });
  });

  it("dates the DISPATCHED event by the challan, not the clock (F3)", async () => {
    // The whole reason backfilling works: a challan from January entered in
    // August belongs in January.
    await inRollback(async (tx) => {
      const f = await fixture(tx, 50);
      const ch = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-01-09" });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 50 },
        tx,
      );
      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        {
          poItemId: f.itemId,
          stageCode: "DISPATCHED",
          eventAt: startOfDayIST("2026-01-09"),
        },
        tx,
      );

      const [event] = await tx
        .select()
        .from(stageEvent)
        .where(eq(stageEvent.stageCode, "DISPATCHED"));

      // Midnight IST on 9 Jan is 18:30 UTC on 8 Jan.
      expect(event!.eventAt.toISOString()).toBe("2026-01-08T18:30:00.000Z");
    });
  });

  it("does not write a second DISPATCHED event when the challan is edited", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);
      const ch = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-20" });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 100 },
        tx,
      );
      await auditedAppend(
        SYSTEM_ACTOR,
        stageEvent,
        { poItemId: f.itemId, stageCode: "DISPATCHED", eventAt: startOfDayIST("2026-08-20") },
        tx,
      );

      // Saving again finds it already at DISPATCHED and appends nothing.
      expect(await completedItems(tx, [f.itemId])).toEqual([]);
    });
  });

  it("refuses to dispatch more than was ordered, naming the overflow", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);
      const ch = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-20" });

      const result = await expectFailure(tx, (sp) =>
        auditedInsert(
          SYSTEM_ACTOR,
          dispatchLine,
          { dispatchId: ch.id, poItemId: f.itemId, qty: 150 },
          sp,
        ),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("exceeds the order");
      expect(result.message).toContain("over by 50");
    });
  });

  it("refuses a line whose item belongs to another client (C8)", async () => {
    await inRollback(async (tx) => {
      const a = await fixture(tx, 100);
      const b = await fixture(tx, 100);
      const ch = await challan(tx, { clientId: a.clientId, dispatchDate: "2026-08-20" });

      const result = await expectFailure(tx, (sp) =>
        auditedInsert(
          SYSTEM_ACTOR,
          dispatchLine,
          { dispatchId: ch.id, poItemId: b.itemId, qty: 10 },
          sp,
        ),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("different client");
    });
  });

  it("releases the quantity when the challan is cancelled", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);
      const ch = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-20" });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 100 },
        tx,
      );

      let [row] = await tx
        .select({ pendingQty: vPoItemStatus.pendingQty, status: vPoItemStatus.status })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, f.itemId));
      expect(row!.pendingQty).toBe(0);

      await tx.execute(sql`update dispatch set status = 'Cancelled' where id = ${ch.id}`);

      [row] = await tx
        .select({ pendingQty: vPoItemStatus.pendingQty, status: vPoItemStatus.status })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, f.itemId));

      expect(row!.pendingQty).toBe(100);
      // The AFTER trigger on `dispatch` reopened it without a line being touched.
      expect(row!.status).toBe("Open");
    });
  });

  /* ---------------------------------------------------------------------- */
  /* F22 — a draft is typed but not gone                                      */
  /* ---------------------------------------------------------------------- */

  it("leaves the quantity owed while a challan is still a draft", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);
      const ch = await challan(tx, {
        clientId: f.clientId,
        dispatchDate: "2026-08-20",
        status: "Draft",
      });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 40 },
        tx,
      );

      const [row] = await tx
        .select({ pendingQty: vPoItemStatus.pendingQty, dispatchedQty: vPoItemStatus.dispatchedQty })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, f.itemId));

      // Still owed in full. Starting a draft must not make an item vanish from
      // the list of what a client is waiting for.
      expect(row!.dispatchedQty).toBe(0);
      expect(row!.pendingQty).toBe(100);

      // And nothing has been delivered, so nothing reached DISPATCHED.
      expect(await completedItems(tx, [f.itemId])).toEqual([]);
    });
  });

  it("consumes the quantity when the draft is marked dispatched", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);
      const ch = await challan(tx, {
        clientId: f.clientId,
        dispatchDate: "2026-08-20",
        status: "Draft",
      });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: ch.id, poItemId: f.itemId, qty: 100 },
        tx,
      );
      await tx.execute(sql`update dispatch set status = 'Dispatched' where id = ${ch.id}`);

      const [row] = await tx
        .select({ pendingQty: vPoItemStatus.pendingQty, status: vPoItemStatus.status })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, f.itemId));

      expect(row!.pendingQty).toBe(0);
      // The recompute trigger on `dispatch` closed it without a line moving.
      expect(row!.status).toBe("Closed");

      // Promotion is the moment the goods left, so it is the moment the event
      // belongs — which the action writes.
      expect(await completedItems(tx, [f.itemId])).toEqual([f.itemId]);
    });
  });

  /**
   * The hole excluding drafts opens, and the guard that closes it.
   *
   * A draft for the whole order and a dispatch for the whole order are each
   * individually valid once drafts do not count. Promoting the draft would put
   * twice the ordered quantity against the item, and the line-level trigger
   * cannot see it because promoting a draft touches no line.
   */
  it("refuses to promote a draft that would take an item over its order", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);

      const draft = await challan(tx, {
        clientId: f.clientId,
        dispatchDate: "2026-08-20",
        status: "Draft",
      });
      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: draft.id, poItemId: f.itemId, qty: 100 },
        tx,
      );

      // Perfectly valid on its own: the draft consumes nothing.
      const gone = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-21" });
      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: gone.id, poItemId: f.itemId, qty: 100 },
        tx,
      );

      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update dispatch set status = 'Dispatched' where id = ${draft.id}`),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("would go over its order");
      expect(result.message).toContain("over by 100");
    });
  });

  it("still allows promoting a draft that fits", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);

      const draft = await challan(tx, {
        clientId: f.clientId,
        dispatchDate: "2026-08-20",
        status: "Draft",
      });
      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: draft.id, poItemId: f.itemId, qty: 60 },
        tx,
      );

      const gone = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-21" });
      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: gone.id, poItemId: f.itemId, qty: 40 },
        tx,
      );

      await tx.execute(sql`update dispatch set status = 'Dispatched' where id = ${draft.id}`);

      const [row] = await tx
        .select({ pendingQty: vPoItemStatus.pendingQty })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, f.itemId));
      expect(row!.pendingQty).toBe(0);
    });
  });

  it("does not check a draft line against the order, since it consumes nothing", async () => {
    // A draft may be typed up for more than is outstanding — it is a plan, and
    // the check happens when it becomes real.
    await inRollback(async (tx) => {
      const f = await fixture(tx, 100);
      const gone = await challan(tx, { clientId: f.clientId, dispatchDate: "2026-08-19" });
      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: gone.id, poItemId: f.itemId, qty: 100 },
        tx,
      );

      const draft = await challan(tx, {
        clientId: f.clientId,
        dispatchDate: "2026-08-20",
        status: "Draft",
      });

      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: draft.id, poItemId: f.itemId, qty: 25 },
        tx,
      );

      const [row] = await tx
        .select({ pendingQty: vPoItemStatus.pendingQty })
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, f.itemId));
      expect(row!.pendingQty).toBe(0);
    });
  });
});
