import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { dispatch, dispatchLine, poItem, purchaseOrder } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";
import {
  MIN_FOR_TREND,
  dispatchedThisMonth,
  otdSummary,
  wipByStage,
  workloadCounts,
} from "@/modules/dashboard/queries";
import { searchItems } from "@/modules/items/queries";

import { inRollback, uniq } from "./helpers";

/**
 * The dashboard's numbers.
 *
 * These run against the real database because the thing being asserted is that
 * the SQL agrees with the views — `v_otd` already excludes null-committed rows
 * (F8) and cancelled items, and the whole value of reading it rather than
 * recomputing is that those rules are not restated here. A mock would restate
 * them and then agree with itself.
 *
 * Every window is measured from `today_ist()`, so the fixtures below place
 * dispatches at offsets from the database's own idea of today rather than from
 * a date typed into the test. A test that hardcoded a date would start failing
 * on a fixed day in the future for a reason nobody would connect to it.
 */

/** A client, an order, and one item with a committed date. */
async function makeItem(
  tx: Tx,
  opts: { orderedQty?: number; committedOffset?: number | null; rate?: string } = {},
) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("DB")}, 'Dashboard Co') returning id`,
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

  const committed =
    opts.committedOffset === null
      ? null
      : ((
          await tx.execute(
            sql`select (today_ist() + ${opts.committedOffset ?? 0}::integer)::text as d`,
          )
        ).rows as { d: string }[])[0]!.d;

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-01-05"),
      purchaseOrderId: order.id,
      itemName: "Dashboard carton",
      orderedQty: opts.orderedQty ?? 1000,
      rate: opts.rate ?? null,
      committedDate: committed,
    },
    tx,
  );

  return { clientId: c!.id, itemId: item.id };
}

/** Dispatches `qty` of `itemId`, `daysAgo` days before today in IST. */
async function dispatchItem(
  tx: Tx,
  clientId: string,
  itemId: string,
  qty: number,
  daysAgo: number,
  rate?: string,
) {
  const rows = (
    await tx.execute(sql`select (today_ist() - ${daysAgo}::integer)::text as d`)
  ).rows as { d: string }[];
  const d = rows[0]!.d;

  const head = await auditedInsert(
    SYSTEM_ACTOR,
    dispatch,
    {
      challanNo: await allocateNumber(tx, "CH", d),
      clientId,
      dispatchDate: d,
      status: "Dispatched",
    },
    tx,
  );

  await auditedInsert(
    SYSTEM_ACTOR,
    dispatchLine,
    { dispatchId: head.id, poItemId: itemId, qty, rate: rate ?? null },
    tx,
  );

  return head.id;
}

/* -------------------------------------------------------------------------- */
/* OTD                                                                         */
/* -------------------------------------------------------------------------- */

describe("on-time delivery", () => {
  it("counts a fully delivered item as on time when it met its date", async () => {
    await inRollback(async (tx) => {
      const before = await otdSummary(tx);

      // Committed 5 days ahead of today, delivered 3 days ago — comfortably in.
      const { clientId, itemId } = await makeItem(tx, { committedOffset: 5 });
      await dispatchItem(tx, clientId, itemId, 1000, 3);

      const after = await otdSummary(tx);
      expect(after.current.total).toBe(before.current.total + 1);
      expect(after.current.onTime).toBe(before.current.onTime + 1);
    });
  });

  it("counts a late delivery as late", async () => {
    await inRollback(async (tx) => {
      const before = await otdSummary(tx);

      // Committed 10 days ago, delivered 3 days ago.
      const { clientId, itemId } = await makeItem(tx, { committedOffset: -10 });
      await dispatchItem(tx, clientId, itemId, 1000, 3);

      const after = await otdSummary(tx);
      expect(after.current.total).toBe(before.current.total + 1);
      expect(after.current.onTime).toBe(before.current.onTime);
    });
  });

  it("EXCLUDES an item with no committed date entirely (F8)", async () => {
    await inRollback(async (tx) => {
      const before = await otdSummary(tx);

      // An imported historical row. It must never count as met and never as
      // missed — an item nobody promised anything about is not a data point.
      const { clientId, itemId } = await makeItem(tx, { committedOffset: null });
      await dispatchItem(tx, clientId, itemId, 1000, 3);

      const after = await otdSummary(tx);
      expect(after.current.total).toBe(before.current.total);
      expect(after.current.onTime).toBe(before.current.onTime);
    });
  });

  it("ignores a partly delivered item until the whole quantity has gone", async () => {
    await inRollback(async (tx) => {
      const before = await otdSummary(tx);

      const { clientId, itemId } = await makeItem(tx, { committedOffset: 5 });
      await dispatchItem(tx, clientId, itemId, 400, 3);
      expect((await otdSummary(tx)).current.total).toBe(before.current.total);

      await dispatchItem(tx, clientId, itemId, 600, 2);
      expect((await otdSummary(tx)).current.total).toBe(before.current.total + 1);
    });
  });

  it("puts a delivery from 45 days ago in the previous window, not the current one", async () => {
    await inRollback(async (tx) => {
      const before = await otdSummary(tx);

      const { clientId, itemId } = await makeItem(tx, { committedOffset: 5 });
      await dispatchItem(tx, clientId, itemId, 1000, 45);

      const after = await otdSummary(tx);
      expect(after.current.total).toBe(before.current.total);
      expect(after.previous.total).toBe(before.previous.total + 1);
    });
  });

  it("reports no percentage at all for an empty window, never zero", async () => {
    await inRollback(async (tx) => {
      // Nothing is inserted. On a database with no deliveries in the window the
      // honest answer is "we cannot tell you", and 0% would read as a total
      // failure to deliver anything on time.
      const summary = await otdSummary(tx);
      if (summary.current.total === 0) {
        expect(summary.current.percent).toBeNull();
      } else {
        expect(summary.current.percent).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it("claims no trend when either window is below the threshold", async () => {
    await inRollback(async (tx) => {
      const summary = await otdSummary(tx);

      // The rule, whichever way the fixture data falls: a change is only
      // reported when BOTH windows carry real volume.
      if (summary.current.total < MIN_FOR_TREND || summary.previous.total < MIN_FOR_TREND) {
        expect(summary.changePoints).toBeNull();
      } else {
        expect(summary.changePoints).not.toBeNull();
      }
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Workload                                                                    */
/* -------------------------------------------------------------------------- */

describe("overdue, at risk and in production", () => {
  it("counts an item past its committed date as overdue", async () => {
    await inRollback(async (tx) => {
      const before = await workloadCounts(tx);

      const { itemId } = await makeItem(tx, { committedOffset: -3 });
      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${itemId}, 'PRINTING', now())`,
      );

      const after = await workloadCounts(tx);
      expect(after.overdue).toBe(before.overdue + 1);
    });
  });

  it("counts an item at a process stage as in production, and one at READY as not", async () => {
    await inRollback(async (tx) => {
      const before = await workloadCounts(tx);

      const printing = await makeItem(tx, { committedOffset: 20 });
      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${printing.itemId}, 'PRINTING', now())`,
      );

      const ready = await makeItem(tx, { committedOffset: 20 });
      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${ready.itemId}, 'READY', now())`,
      );

      const after = await workloadCounts(tx);

      // Both are open work; only one is happening to paper (F18).
      expect(after.open).toBe(before.open + 2);
      expect(after.inProduction).toBe(before.inProduction + 1);
    });
  });

  it("agrees with the Item Tracker's overdue filter, because both read the view", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx, { committedOffset: -3 });
      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${itemId}, 'PRINTING', now())`,
      );

      // The dashboard tile links to this list, so a disagreement between the
      // count and the rows would be visible the moment somebody clicked it.
      const counts = await workloadCounts(tx);
      const rows = await searchItems("", { openOnly: true, risk: "overdue", limit: 1000 });
      expect(rows.length).toBeLessThanOrEqual(counts.overdue);
      expect(rows.every((r) => r.isOverdue)).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Dispatched this month                                                       */
/* -------------------------------------------------------------------------- */

describe("dispatched this month", () => {
  it("values a line from the item's rate when the line carries none", async () => {
    await inRollback(async (tx) => {
      const before = await dispatchedThisMonth(tx);

      const { clientId, itemId } = await makeItem(tx, { committedOffset: 5, rate: "12.50" });
      // Today, so it is inside the calendar month whatever day it is run.
      await dispatchItem(tx, clientId, itemId, 200, 0);

      const after = await dispatchedThisMonth(tx);
      expect(after.items).toBe(before.items + 1);
      expect((after.value ?? 0) - (before.value ?? 0)).toBeCloseTo(2500, 2);
      expect(after.linesWithoutRate).toBe(before.linesWithoutRate);
    });
  });

  it("counts a line with no rate anywhere, and says it could not value it", async () => {
    await inRollback(async (tx) => {
      const before = await dispatchedThisMonth(tx);

      const { clientId, itemId } = await makeItem(tx, { committedOffset: 5 });
      await dispatchItem(tx, clientId, itemId, 200, 0);

      const after = await dispatchedThisMonth(tx);
      // The quantity is real even though the money is not knowable.
      expect(after.items).toBe(before.items + 1);
      expect(after.linesWithoutRate).toBe(before.linesWithoutRate + 1);
    });
  });

  it("excludes a cancelled challan, exactly as the spine view does", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { committedOffset: 5, rate: "10.00" });
      const challanId = await dispatchItem(tx, clientId, itemId, 100, 0);

      const withChallan = await dispatchedThisMonth(tx);

      await tx.execute(sql`update dispatch set status = 'Cancelled' where id = ${challanId}`);
      const afterCancel = await dispatchedThisMonth(tx);

      expect(afterCancel.items).toBe(withChallan.items - 1);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* WIP                                                                         */
/* -------------------------------------------------------------------------- */

describe("WIP by stage", () => {
  it("buckets an open item under its current stage, with the stage's own colour", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx, { committedOffset: 12 });
      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${itemId}, 'LAMINATION', now())`,
      );

      const bars = await wipByStage(tx);
      const lamination = bars.find((b) => b.code === "LAMINATION");

      expect(lamination).toBeDefined();
      expect(lamination!.items).toBeGreaterThanOrEqual(1);
      // Non-negotiable 5: the colour comes from the stage table, never a map
      // in a component.
      expect(lamination!.colour).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it("drops an item out of WIP once the whole quantity has been delivered", async () => {
    await inRollback(async (tx) => {
      const { clientId, itemId } = await makeItem(tx, { committedOffset: 12 });
      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${itemId}, 'UV', now())`,
      );

      const withWip = (await wipByStage(tx)).find((b) => b.code === "UV")?.items ?? 0;
      await dispatchItem(tx, clientId, itemId, 1000, 0);
      const afterWip = (await wipByStage(tx)).find((b) => b.code === "UV")?.items ?? 0;

      expect(afterWip).toBe(withWip - 1);
    });
  });
});
