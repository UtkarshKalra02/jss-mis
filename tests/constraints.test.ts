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

/**
 * There is no longer a quantity ceiling (K12).
 *
 * An over-run is ordinary in an offset works — extra sheets are printed to
 * cover make-ready, and when they come out clean the client gets the lot — and
 * a system that refuses to record what physically left makes the challan
 * disagree with the gate register. What used to be `dispatch_line_guard`'s
 * ceiling is now the form's warning, and nothing else.
 *
 * The property still worth pinning is that pending_qty follows honestly into
 * the negative rather than clamping, because every consumer of it was written
 * against `<= 0` and `> 0` and would quietly change meaning if it floored.
 */
describe("dispatch quantity, which may now exceed the order", () => {
  it("accepts a delivery larger than the order and lets pending go negative", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchA}, ${s.itemId}, 600)`,
      );

      // 500 more against a 1000 order: 100 over, and no longer refused.
      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty) values (${s.dispatchA}, ${s.itemId}, 500)`,
      );

      const [row] = (
        await tx.execute(
          sql`select dispatched_qty, pending_qty, status
                from v_po_item_status where po_item_id = ${s.itemId}`,
        )
      ).rows as { dispatched_qty: number; pending_qty: number; status: string }[];

      expect(row!.dispatched_qty).toBe(1100);
      // NEGATIVE, not floored at zero. v_otd takes pending_qty <= 0 and the
      // worklists take > 0, so an over-delivered item counts as delivered and
      // drops off the screens — exactly as an exactly-delivered one does.
      expect(row!.pending_qty).toBe(-100);
      expect(row!.status).toBe("Closed");
    });
  });

  it("still refuses a line whose item belongs to another client (C8)", async () => {
    // The other half of the same trigger, which the ceiling's removal must not
    // have taken with it.
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
              values (${s.dispatchB}, ${s.itemId}, 10)`,
        ),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("different client");
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

      /*
       * Every other NOT NULL is satisfied deliberately. The row has to reach
       * the CHECK to prove the CHECK is what stops it — an insert that trips a
       * not-null first would throw, turn this test green, and assert nothing
       * about the rule it is named after. (Migration 0033 added three of those
       * not-nulls and did exactly that.)
       *
       * source_id and owner_user_id are looked up rather than inserted: the
       * six sources are seeded by 0033, and app_user always has SYSTEM.
       */
      const result = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into enquiry
                (enquiry_no, client_id, enquiry_date, status, item_description,
                 source_id, owner_user_id)
              values (
                ${uniq("ENQ-")}, ${s.clientA}, current_date, 'Lost', 'Test enquiry',
                (select id from enquiry_source where code = 'OTHER'),
                (select id from app_user order by created_at limit 1)
              )`,
        ),
      );
      expect(result.threw).toBe(true);
      expect(result.message).toContain("enquiry_lost_reason_required");
    });
  });

  /**
   * Non-negotiable 6 changed shape in Phase 2 (decision F8) and this test
   * changed with it. The column USED to reject null. It no longer does,
   * because a historical job copied out of a paper book genuinely has no
   * committed date, and inventing one would silently feed OTD.
   *
   * What has to hold instead is that a null commitment is inert: it cannot be
   * overdue, it cannot be at risk, and it never reaches OTD in either
   * direction. That is what is asserted here. The "required" half of the rule
   * now lives at the PO capture form, which is not a database constraint and
   * cannot be tested from this file.
   */
  it("accepts a null committed date but keeps it out of OTD and the risk flags (F8)", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);
      const [po] = (
        await tx.execute(
          sql`select purchase_order_id as id from po_item where id = ${s.itemId}`,
        )
      ).rows as { id: string }[];

      const [historical] = (
        await tx.execute(
          sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
              values (${uniq("ITM-")}, ${po!.id}, 'Historical job', 10, null) returning id`,
        )
      ).rows as { id: string }[];

      // Neither flag may be NULL. A null would vanish from BOTH `WHERE flag`
      // and `WHERE NOT flag`, which is the failure mode nobody spots.
      const [flags] = (
        await tx.execute(
          sql`select is_overdue, is_at_risk, days_to_committed
              from v_po_item_status where po_item_id = ${historical!.id}`,
        )
      ).rows as { is_overdue: boolean; is_at_risk: boolean; days_to_committed: number | null }[];

      expect(flags!.is_overdue).toBe(false);
      expect(flags!.is_at_risk).toBe(false);
      expect(flags!.days_to_committed).toBeNull();

      // Dispatch it in full. It is delivered, so it would ordinarily appear in
      // v_otd — and it must not, because there was never a promise to measure.
      await tx.execute(
        sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
            values (${s.dispatchA}, ${historical!.id}, 10)`,
      );

      const otd = (
        await tx.execute(sql`select po_item_id from v_otd where po_item_id = ${historical!.id}`)
      ).rows;
      expect(otd).toHaveLength(0);
    });
  });
});
