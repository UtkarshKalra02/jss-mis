import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Migration 0038 — an item before its PO, and moving it when the PO comes
 * (decision N1).
 *
 * Raw SQL, like tests/po-status.test.ts and for the same reason: the guard
 * and the recompute are triggers, and the claim is that they hold against ANY
 * writer, not only the action that knows to call them.
 */

const SYSTEM = "00000000-0000-0000-0000-000000000000";

async function makeClient(tx: Tx) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("N")}, 'Move Co') returning id`,
    )
  ).rows as { id: string }[];
  return c!.id;
}

async function makeOrder(tx: Tx, clientId: string, poNo: string | null = null) {
  const [po] = (
    await tx.execute(
      sql`insert into purchase_order (internal_no, client_id, po_date, po_no)
          values (${uniq("PO-")}, ${clientId}, current_date, ${poNo}) returning id`,
    )
  ).rows as { id: string }[];
  return po!.id;
}

async function makeItem(tx: Tx, poId: string, orderedQty = 1000) {
  const [item] = (
    await tx.execute(
      sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
          values (${uniq("ITM-")}, ${poId}, 'Carton', ${orderedQty}, current_date) returning id`,
    )
  ).rows as { id: string }[];
  return item!.id;
}

async function dispatchAll(tx: Tx, clientId: string, itemId: string, qty: number) {
  const [d] = (
    await tx.execute(
      sql`insert into dispatch (challan_no, client_id, dispatch_date, status)
          values (${uniq("CH-")}, ${clientId}, current_date, 'Dispatched') returning id`,
    )
  ).rows as { id: string }[];
  await tx.execute(
    sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${d!.id}, ${itemId}, ${qty})`,
  );
}

async function poAwaited(tx: Tx, itemId: string): Promise<boolean> {
  const [row] = (
    await tx.execute(sql`select po_awaited from v_po_item_status where po_item_id = ${itemId}`)
  ).rows as { po_awaited: boolean }[];
  return row!.po_awaited;
}

async function poStatus(tx: Tx, poId: string): Promise<string> {
  const [row] = (await tx.execute(sql`select status from purchase_order where id = ${poId}`))
    .rows as { status: string }[];
  return row!.status;
}

describe("po_awaited (N1)", () => {
  it("is true for a typed order with no client PO number, and false once one is recorded", async () => {
    await inRollback(async (tx) => {
      const c = await makeClient(tx);
      const po = await makeOrder(tx, c);
      const item = await makeItem(tx, po);

      expect(await poAwaited(tx, item)).toBe(true);

      await tx.execute(sql`update purchase_order set po_no = '4500123' where id = ${po}`);
      expect(await poAwaited(tx, item)).toBe(false);
    });
  });

  it("is false for an imported historical order with no number — nothing is awaited", async () => {
    await inRollback(async (tx) => {
      const c = await makeClient(tx);
      const po = await makeOrder(tx, c);
      const item = await makeItem(tx, po);

      const [batch] = (
        await tx.execute(
          sql`insert into import_batch (filename, imported_by) values ('book.xlsx', ${SYSTEM}) returning id`,
        )
      ).rows as { id: string }[];
      await tx.execute(
        sql`update purchase_order set import_batch_id = ${batch!.id} where id = ${po}`,
      );

      expect(await poAwaited(tx, item)).toBe(false);
    });
  });
});

describe("moving an item between orders (0038)", () => {
  it("refuses a move to another client's order", async () => {
    await inRollback(async (tx) => {
      const a = await makeClient(tx);
      const b = await makeClient(tx);
      const poA = await makeOrder(tx, a);
      const poB = await makeOrder(tx, b);
      const item = await makeItem(tx, poA);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update po_item set purchase_order_id = ${poB} where id = ${item}`),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("different client");
    });
  });

  it("refuses a move to a removed order", async () => {
    await inRollback(async (tx) => {
      const c = await makeClient(tx);
      const from = await makeOrder(tx, c);
      const to = await makeOrder(tx, c);
      const item = await makeItem(tx, from);
      await tx.execute(sql`update purchase_order set deleted_at = now() where id = ${to}`);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update po_item set purchase_order_id = ${to} where id = ${item}`),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("removed order");
    });
  });

  it("allows a move within one client, and both orders settle their status", async () => {
    await inRollback(async (tx) => {
      const c = await makeClient(tx);
      const from = await makeOrder(tx, c);
      const to = await makeOrder(tx, c, "4500999");

      const delivered = await makeItem(tx, from, 500);
      await makeItem(tx, from, 800);
      await dispatchAll(tx, c, delivered, 500);

      // One item delivered, one not: the source is Partially Dispatched.
      expect(await poStatus(tx, from)).toBe("Partially Dispatched");
      expect(await poStatus(tx, to)).toBe("Open");

      await tx.execute(
        sql`update po_item set purchase_order_id = ${to} where id = ${delivered}`,
      );

      // The delivered item left. What remains on the source has nothing
      // dispatched, so it is Open again; the target now holds only a
      // delivered item, so it is Closed. Neither was told — the trigger did it.
      expect(await poStatus(tx, from)).toBe("Open");
      expect(await poStatus(tx, to)).toBe("Closed");

      // The item is no longer PO awaited, because the order it moved onto
      // has a number.
      expect(await poAwaited(tx, delivered)).toBe(false);
    });
  });

  it("leaves the item's dispatch history attached — it moves with the item", async () => {
    await inRollback(async (tx) => {
      const c = await makeClient(tx);
      const from = await makeOrder(tx, c);
      const to = await makeOrder(tx, c, "4500777");
      const item = await makeItem(tx, from, 1000);
      await dispatchAll(tx, c, item, 400);

      await tx.execute(sql`update po_item set purchase_order_id = ${to} where id = ${item}`);

      const [row] = (
        await tx.execute(
          sql`select dispatched_qty, pending_qty, purchase_order_id
              from v_po_item_status where po_item_id = ${item}`,
        )
      ).rows as { dispatched_qty: number; pending_qty: number; purchase_order_id: string }[];

      expect(row!.purchase_order_id).toBe(to);
      expect(row!.dispatched_qty).toBe(400);
      expect(row!.pending_qty).toBe(600);
    });
  });
});
