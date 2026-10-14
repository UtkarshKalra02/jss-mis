import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { dispatch, dispatchLine, poItem, purchaseOrder } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";

import { inRollback, uniq } from "./helpers";

/**
 * Small residuals close themselves once the month turns (T1).
 *
 * MOST OF THESE TESTS ASSERT THAT IT DOES NOT FIRE. The rule's whole risk is
 * closing something it should not — an order nobody printed, a promise that
 * has not come due, a residual that is still worth running — and those are
 * silent failures: an item simply stops appearing on the pending list and
 * nobody goes looking for it. The one happy path is the easy part.
 *
 * Run against the real database, because the rule lives in a plpgsql function
 * fired by triggers. A mock would test the mock.
 */

/** A client, an order, and one item committed `monthsAgo` months back. */
async function makeItem(
  tx: Tx,
  opts: { orderedQty: number; monthsAgo: number | null },
) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("AC")}, 'Auto Close Co') returning id`,
    )
  ).rows as { id: string }[];

  const order = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", "2026-01-05"),
      clientId: c!.id,
      poDate: "2026-01-05",
    },
    tx,
  );

  /*
   * Committed date is built from today_ist(), never a typed date (C10) — and
   * by whole months, because the rule compares month to month. "One month ago"
   * on the 31st has to land inside the previous month, so this takes the first
   * of the month and steps back, rather than subtracting 30 days.
   */
  const committed =
    opts.monthsAgo === null
      ? null
      : (
          (
            await tx.execute(sql`
              select (date_trunc('month', today_ist()) - (${opts.monthsAgo}::integer || ' month')::interval
                     )::date::text as d
            `)
          ).rows as { d: string }[]
        )[0]!.d;

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-01-05"),
      purchaseOrderId: order.id,
      itemName: "Auto close carton",
      orderedQty: opts.orderedQty,
      committedDate: committed,
    },
    tx,
  );

  return { clientId: c!.id, itemId: item.id };
}

async function deliver(tx: Tx, clientId: string, itemId: string, qty: number) {
  const [d] = (await tx.execute(sql`select today_ist()::text as d`)).rows as { d: string }[];

  const head = await auditedInsert(
    SYSTEM_ACTOR,
    dispatch,
    {
      challanNo: await allocateNumber(tx, "CH", d!.d),
      clientId,
      dispatchDate: d!.d,
      status: "Dispatched",
    },
    tx,
  );

  await auditedInsert(
    SYSTEM_ACTOR,
    dispatchLine,
    { dispatchId: head.id, poItemId: itemId, qty },
    tx,
  );
}

async function statusOf(tx: Tx, itemId: string): Promise<string> {
  const rows = (
    await tx.execute(sql`select status from po_item where id = ${itemId}`)
  ).rows as { status: string }[];
  return rows[0]!.status;
}

describe("auto-closing a small residual", () => {
  it("closes a part-delivered item whose committed month has passed", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: 1 });
      await deliver(tx, clientId, itemId, 8_900);
      // 1,100 pending, under 1,500, committed last month.
      expect(await statusOf(tx, itemId)).toBe("Closed");
    });
  });

  it("does NOT close an item nobody has delivered against", async () => {
    await inRollback(async (tx) => {
      // 1,200 ordered is under the threshold from the day it is placed. Without
      // the dispatched > 0 guard this would close itself having never been
      // printed, which is the worst failure available to this rule.
      const { itemId } = await makeItem(tx, { orderedQty: 1_200, monthsAgo: 1 });
      expect(await statusOf(tx, itemId)).toBe("Open");
    });
  });

  it("does NOT close while the committed date is still in this month", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: 0 });
      await deliver(tx, clientId, itemId, 8_900);
      // The promise has not come due. Same residual, different month.
      expect(await statusOf(tx, itemId)).toBe("Open");
    });
  });

  it("does NOT close a residual that is still worth printing", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: 1 });
      await deliver(tx, clientId, itemId, 7_000);
      // 3,000 pending — over the threshold, so it stays on the list.
      expect(await statusOf(tx, itemId)).toBe("Open");
    });
  });

  it("does NOT close an item with no committed date (F8)", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: null });
      await deliver(tx, clientId, itemId, 8_900);
      // Historical rows carry no promise, so no month can have passed.
      expect(await statusOf(tx, itemId)).toBe("Open");
    });
  });

  it("leaves Cancelled alone — it is a human decision", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: 1 });
      await tx.execute(sql`select set_config('jss.allow_status_write', 'on', true)`);
      await tx.execute(sql`update po_item set status = 'Cancelled' where id = ${itemId}`);
      await tx.execute(sql`select set_config('jss.allow_status_write', 'off', true)`);

      await deliver(tx, clientId, itemId, 8_900);
      expect(await statusOf(tx, itemId)).toBe("Cancelled");
    });
  });

  it("records why it closed, so a short close is not mistaken for a full one", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: 1 });
      await deliver(tx, clientId, itemId, 8_900);

      const rows = (
        await tx.execute(sql`
          select after from audit_log
          where table_name = 'po_item' and record_id = ${itemId}
            and after ->> 'status' = 'Closed'
          order by changed_at desc limit 1
        `)
      ).rows as { after: Record<string, unknown> }[];

      expect(rows[0]!.after).toMatchObject({
        status: "Closed",
        reason: "short_closed",
        pendingWrittenOff: 1_100,
      });
    });
  });

  it("obeys the threshold setting rather than a hardcoded 1500", async () => {
    await inRollback(async (tx) => {
      // Dropped to 500, a 1,100 residual is no longer small enough to retire.
      await tx.execute(
        sql`update app_setting set value = '500' where key = 'auto_close_pending_below'`,
      );
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: 1 });
      await deliver(tx, clientId, itemId, 8_900);
      expect(await statusOf(tx, itemId)).toBe("Open");
    });
  });

  it("counts a short-closed item in OTD, judged on its last dispatch", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { orderedQty: 10_000, monthsAgo: 1 });
      await deliver(tx, clientId, itemId, 8_900);

      const rows = (
        await tx.execute(sql`
          select on_time, days_late, fulfilment_date::text as fulfilment_date
          from v_otd where po_item_id = ${itemId}
        `)
      ).rows as { on_time: boolean; days_late: number }[];

      // Delivered this month against a promise from last month: counted, and
      // counted as late. Before this change the row was absent entirely.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.on_time).toBe(false);
      expect(rows[0]!.days_late).toBeGreaterThan(0);
    });
  });
});
