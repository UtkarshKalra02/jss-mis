import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { withStatusWrite } from "@/db/po-status";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Decision B5 made real — migration 0006.
 *
 * purchase_order.status and po_item.status are derived values that are stored,
 * and the promise attached to that was always "only the recompute function and
 * the Cancel action may write them". Until 0006 that promise was a comment in
 * a doc file, which is to say it was not true.
 *
 * These tests are written as raw SQL, like tests/constraints.test.ts, and for
 * the same reason: the point is that the rules hold against ANY writer,
 * including a psql session or an import script that never loads the
 * application. Testing them through the audit wrapper would only prove the
 * wrapper behaves.
 */

async function scenario(tx: Tx, opts: { orderedQty?: number } = {}) {
  const ordered = opts.orderedQty ?? 1000;

  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("S")}, 'Status Co') returning id`,
    )
  ).rows as { id: string }[];

  const [po] = (
    await tx.execute(
      sql`insert into purchase_order (internal_no, client_id, po_date)
          values (${uniq("PO-")}, ${c!.id}, current_date) returning id`,
    )
  ).rows as { id: string }[];

  const [item] = (
    await tx.execute(
      sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
          values (${uniq("ITM-")}, ${po!.id}, 'Status item', ${ordered}, current_date) returning id`,
    )
  ).rows as { id: string }[];

  const [d] = (
    await tx.execute(
      sql`insert into dispatch (challan_no, client_id, dispatch_date, status)
          values (${uniq("CH-")}, ${c!.id}, current_date, 'Dispatched') returning id`,
    )
  ).rows as { id: string }[];

  return { clientId: c!.id, poId: po!.id, itemId: item!.id, dispatchId: d!.id, ordered };
}

async function statuses(tx: Tx, s: { itemId: string; poId: string }) {
  const [item] = (await tx.execute(sql`select status from po_item where id = ${s.itemId}`))
    .rows as { status: string }[];
  const [po] = (await tx.execute(sql`select status from purchase_order where id = ${s.poId}`))
    .rows as { status: string }[];
  return { item: item!.status, po: po!.status };
}

describe("status write lock (B5)", () => {
  it("refuses a direct write to po_item.status", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update po_item set status = 'Closed' where id = ${s.itemId}`),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("derived");
      // The message has to say what to do instead, not just "no".
      expect(result.message).toContain("Cancel action");
    });
  });

  it("refuses a direct write to purchase_order.status", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update purchase_order set status = 'Closed' where id = ${s.poId}`),
      );
      expect(result.threw).toBe(true);
    });
  });

  it("refuses a row that is born with a status other than Open", async () => {
    // Otherwise the lock is trivially sidestepped by inserting rather than
    // updating.
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date, status)
              values (${uniq("ITM-")}, ${s.poId}, 'Born closed', 5, current_date, 'Closed')`,
        ),
      );
      expect(result.threw).toBe(true);
    });
  });

  it("allows an ordinary edit that does not touch status", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      await tx.execute(sql`update po_item set item_name = 'Renamed' where id = ${s.itemId}`);

      const [row] = (
        await tx.execute(sql`select item_name from po_item where id = ${s.itemId}`)
      ).rows as { item_name: string }[];
      expect(row!.item_name).toBe("Renamed");
    });
  });

  it("lets the Cancel action through, and shuts the door behind it", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      await withStatusWrite(tx, async () => {
        await tx.execute(sql`update po_item set status = 'Cancelled' where id = ${s.itemId}`);
      });

      expect((await statuses(tx, s)).item).toBe("Cancelled");

      // The setting is not left on for the rest of the transaction.
      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update po_item set status = 'Open' where id = ${s.itemId}`),
      );
      expect(result.threw).toBe(true);
    });
  });
});

describe("status recompute (B5)", () => {
  it("closes an item when the last of the quantity is dispatched", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 1000 });

      expect(await statuses(tx, s)).toEqual({ item: "Open", po: "Open" });

      // Partial: still open, but the PO is now partially dispatched.
      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 400)`,
      );
      expect(await statuses(tx, s)).toEqual({ item: "Open", po: "Partially Dispatched" });

      // The remainder closes both.
      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 600)`,
      );
      expect(await statuses(tx, s)).toEqual({ item: "Closed", po: "Closed" });
    });
  });

  it("reopens an item when its challan is cancelled", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 100 });

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 100)`,
      );
      expect(await statuses(tx, s)).toEqual({ item: "Closed", po: "Closed" });

      // Cancelling the challan touches no dispatch_line row at all, which is
      // exactly why the recompute needs a trigger on `dispatch` too.
      await tx.execute(
        sql`update dispatch set status = 'Cancelled' where id = ${s.dispatchId}`,
      );
      expect(await statuses(tx, s)).toEqual({ item: "Open", po: "Open" });
    });
  });

  it("reopens an item when its dispatch line is soft deleted", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 50 });

      const [line] = (
        await tx.execute(
          sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
              values (${s.dispatchId}, ${s.itemId}, 50) returning id`,
        )
      ).rows as { id: string }[];
      expect((await statuses(tx, s)).item).toBe("Closed");

      await tx.execute(sql`update dispatch_line set deleted_at = now() where id = ${line!.id}`);
      expect((await statuses(tx, s)).item).toBe("Open");
    });
  });

  it("never derives 'Cancelled' away", async () => {
    // Cancelled is a human decision. Dispatch quantities have no opinion on it.
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 100 });

      await withStatusWrite(tx, async () => {
        await tx.execute(sql`update po_item set status = 'Cancelled' where id = ${s.itemId}`);
      });

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 100)`,
      );

      expect((await statuses(tx, s)).item).toBe("Cancelled");
    });
  });

  it("closes a PO whose remaining live items are all delivered", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 10 });

      const [second] = (
        await tx.execute(
          sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
              values (${uniq("ITM-")}, ${s.poId}, 'Second item', 5, current_date) returning id`,
        )
      ).rows as { id: string }[];

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 10)`,
      );
      // One of two items delivered — not closed yet.
      expect((await statuses(tx, s)).po).toBe("Partially Dispatched");

      // Cancelling the other one leaves nothing outstanding.
      await withStatusWrite(tx, async () => {
        await tx.execute(sql`update po_item set status = 'Cancelled' where id = ${second!.id}`);
      });
      await tx.execute(sql`select recompute_for_po_item(${s.itemId}::uuid)`);

      expect((await statuses(tx, s)).po).toBe("Closed");
    });
  });

  it("audits the status change it makes (non-negotiable 3)", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 20 });

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 20)`,
      );

      const rows = (
        await tx.execute(
          sql`select action, changed_by, before, after from audit_log
              where table_name = 'po_item' and record_id = ${s.itemId}`,
        )
      ).rows as {
        action: string;
        changed_by: string;
        before: { status: string };
        after: { status: string };
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe("UPDATE");
      expect(rows[0]!.before.status).toBe("Open");
      expect(rows[0]!.after.status).toBe("Closed");
      // Attributed to SYSTEM — there is no human behind a trigger (C4).
      expect(rows[0]!.changed_by).toBe("00000000-0000-0000-0000-000000000000");
    });
  });

  it("writes nothing when the status has not actually changed", async () => {
    // The nightly sweep runs over every live item. If a no-op logged, the
    // audit trail would be unreadable within a week.
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 20 });

      await tx.execute(sql`select recompute_for_po_item(${s.itemId}::uuid)`);
      await tx.execute(sql`select recompute_for_po_item(${s.itemId}::uuid)`);

      const rows = (
        await tx.execute(
          sql`select id from audit_log where table_name = 'po_item' and record_id = ${s.itemId}`,
        )
      ).rows;
      expect(rows).toHaveLength(0);
    });
  });
});

describe("reverse quantity guard", () => {
  it("refuses to reduce an order below what has already been dispatched", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 1000 });

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 600)`,
      );

      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update po_item set ordered_qty = 500 where id = ${s.itemId}`),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("already been dispatched");

      // pending_qty must never have gone negative.
      const [v] = (
        await tx.execute(
          sql`select pending_qty from v_po_item_status where po_item_id = ${s.itemId}`,
        )
      ).rows as { pending_qty: number }[];
      expect(v!.pending_qty).toBe(400);
    });
  });

  it("allows a reduction down to exactly what has been dispatched, and closes it", async () => {
    // Correcting an over-entered order is legitimate, and completing the item
    // is the correct consequence.
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 1000 });

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 600)`,
      );
      await tx.execute(sql`update po_item set ordered_qty = 600 where id = ${s.itemId}`);

      expect((await statuses(tx, s)).item).toBe("Closed");
    });
  });

  it("allows an increase", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx, { orderedQty: 100 });

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchId}, ${s.itemId}, 100)`,
      );
      expect((await statuses(tx, s)).item).toBe("Closed");

      await tx.execute(sql`update po_item set ordered_qty = 150 where id = ${s.itemId}`);
      // More was ordered, so it is open again.
      expect((await statuses(tx, s)).item).toBe("Open");
    });
  });
});
