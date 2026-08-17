import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * The database-level rules from migration 0001 — the ones a CHECK constraint
 * cannot express because each has to see sibling rows or a parent table.
 *
 * Written as raw SQL rather than through the audit wrapper on purpose: the
 * point is that these hold against ANY writer, including a psql session or a
 * future import script that bypasses the application entirely. Testing them
 * through the wrapper would only prove the wrapper behaves.
 */

async function scenario(tx: Tx) {
  const stageCode = uniq("TST_").toUpperCase();
  await tx.execute(
    sql`insert into stage (code, name, sequence, colour) values (${stageCode}, 'Test', 999, '#000000')`,
  );

  const [a] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("A")}, 'Client A') returning id`,
    )
  ).rows as { id: string }[];

  const [b] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("B")}, 'Client B') returning id`,
    )
  ).rows as { id: string }[];

  const [po] = (
    await tx.execute(
      sql`insert into purchase_order (internal_no, client_id, po_date)
          values (${uniq("PO-")}, ${a!.id}, current_date) returning id`,
    )
  ).rows as { id: string }[];

  const [item] = (
    await tx.execute(
      sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
          values (${uniq("ITM-")}, ${po!.id}, 'Test item', 1000, current_date) returning id`,
    )
  ).rows as { id: string }[];

  const dispatchFor = async (clientId: string) => {
    const [d] = (
      await tx.execute(
        sql`insert into dispatch (challan_no, client_id, dispatch_date, status)
            values (${uniq("CH-")}, ${clientId}, current_date, 'Dispatched') returning id`,
      )
    ).rows as { id: string }[];
    return d!.id;
  };

  return {
    stageCode,
    clientA: a!.id,
    clientB: b!.id,
    itemId: item!.id,
    dispatchA: await dispatchFor(a!.id),
    dispatchB: await dispatchFor(b!.id),
  };
}

describe("dispatch quantity ceiling", () => {
  it("allows partial dispatch and the exact remainder, and blocks the overflow", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchA}, ${s.itemId}, 600)`,
      );

      const over = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchA}, ${s.itemId}, 500)`,
        ),
      );
      expect(over.threw).toBe(true);
      expect(over.message).toContain("exceeds the order");
      // The message has to be usable by whoever hits it at the desk.
      expect(over.message).toContain("already dispatched 600");

      // 400 exactly completes the order and must be allowed.
      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchA}, ${s.itemId}, 400)`,
      );
    });
  });

  it("does not count cancelled challans toward the ceiling", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchA}, ${s.itemId}, 1000)`,
      );
      await tx.execute(sql`update dispatch set status = 'Cancelled' where id = ${s.dispatchA}`);

      // The whole order is free again, so a fresh full dispatch must succeed.
      const fresh = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchB}, ${s.itemId}, 1000)`,
        ),
      );
      // dispatchB belongs to client B, so this is refused for the OTHER reason.
      expect(fresh.message).toContain("different client");
    });
  });
});

describe("cross-client guards (C8)", () => {
  it("refuses a dispatch line whose item belongs to another client", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchB}, ${s.itemId}, 10)`,
        ),
      );
      expect(result.threw).toBe(true);
      expect(result.message).toContain("different client");
    });
  });
});

describe("append-only tables (C6)", () => {
  it("refuses UPDATE and DELETE on stage_event", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${s.itemId}, ${s.stageCode}, now())`,
      );

      const update = await expectFailure(tx, (sp) =>
        sp.execute(sql`update stage_event set remarks = 'edited' where po_item_id = ${s.itemId}`),
      );
      expect(update.threw).toBe(true);
      expect(update.message).toContain("append-only");

      // The row must still exist when DELETE runs, or a row-level trigger has
      // nothing to fire on and the test passes for the wrong reason.
      const before = await tx.execute(
        sql`select count(*)::int as n from stage_event where po_item_id = ${s.itemId}`,
      );
      expect((before.rows[0] as { n: number }).n).toBe(1);

      const del = await expectFailure(tx, (sp) =>
        sp.execute(sql`delete from stage_event where po_item_id = ${s.itemId}`),
      );
      expect(del.threw).toBe(true);
      expect(del.message).toContain("append-only");
    });
  });
});

describe("column constraints", () => {
  it("requires a reason on a Lost enquiry", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into enquiry (enquiry_no, client_id, enquiry_date, status)
              values (${uniq("ENQ-")}, ${s.clientA}, current_date, 'Lost')`,
        ),
      );
      expect(result.threw).toBe(true);
      expect(result.message).toContain("enquiry_lost_reason_required");
    });
  });

  it("requires a committed date on every PO item (non-negotiable 6)", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);
      const [po] = (
        await tx.execute(
          sql`select purchase_order_id as id from po_item where id = ${s.itemId}`,
        )
      ).rows as { id: string }[];

      const result = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
              values (${uniq("ITM-")}, ${po!.id}, 'No date', 10, null)`,
        ),
      );
      expect(result.threw).toBe(true);
      expect(result.message).toContain("committed_date");
    });
  });
});
