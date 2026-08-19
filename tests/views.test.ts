import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import {
  vArAgeing,
  vClientSummary,
  vEnquiryFunnel,
  vOtd,
  vPoItemStatus,
  vWipAgeing,
} from "@/db/views";

import { inRollback, uniq } from "./helpers";

/**
 * src/db/views.ts describes six views it does not own — the definitions live
 * in migrations 0002 and 0006. Nothing makes the description and the database
 * agree except these tests.
 *
 * That gap is not theoretical. A view column renamed in a migration leaves the
 * TypeScript happily compiling and fails at runtime, on a screen, with a
 * Postgres error about a column that does not exist. Selecting every declared
 * column from every view is what turns that into a red test instead.
 */

describe("view definitions match the database", () => {
  // db.select().from(view) names every column declared in views.ts, so a typo
  // or a rename is a query error here rather than a 500 on a screen later.
  const views = {
    v_po_item_status: vPoItemStatus,
    v_otd: vOtd,
    v_wip_ageing: vWipAgeing,
    v_ar_ageing: vArAgeing,
    v_client_summary: vClientSummary,
    v_enquiry_funnel: vEnquiryFunnel,
  };

  for (const [name, view] of Object.entries(views)) {
    it(`can select every declared column from ${name}`, async () => {
      await inRollback(async (tx) => {
        await expect(tx.select().from(view).limit(1)).resolves.toBeDefined();
      });
    });
  }
});

/**
 * A live item, with a stage event and a partial dispatch, so the spine view
 * has something real to derive from.
 */
async function scenario(tx: Tx) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("V")}, 'View Co') returning id`,
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
          values (${uniq("ITM-")}, ${po!.id}, 'View item', 1000, current_date + 10) returning id`,
    )
  ).rows as { id: string }[];

  // PRINTING is a seeded stage, so its colour comes from the stage table —
  // which is the whole point of non-negotiable 5.
  await tx.execute(
    sql`insert into stage_event (po_item_id, stage_code, event_at)
        values (${item!.id}, 'PRINTING', now())`,
  );

  const [d] = (
    await tx.execute(
      sql`insert into dispatch (challan_no, client_id, dispatch_date, status)
          values (${uniq("CH-")}, ${c!.id}, current_date, 'Dispatched') returning id`,
    )
  ).rows as { id: string }[];

  await tx.execute(
    sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
        values (${d!.id}, ${item!.id}, 400)`,
  );

  return { itemId: item!.id };
}

describe("v_po_item_status through Drizzle", () => {
  it("returns derived quantities and stage, typed", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      const [row] = await tx
        .select()
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, s.itemId));

      expect(row).toBeDefined();

      // NON-NEGOTIABLE 2 — computed, not stored.
      expect(row!.orderedQty).toBe(1000);
      expect(row!.dispatchedQty).toBe(400);
      expect(row!.pendingQty).toBe(600);

      // NON-NEGOTIABLE 1 — derived from the latest event.
      expect(row!.currentStage).toBe("PRINTING");
      expect(row!.currentStageName).toBe("Printing");
      // The colour comes from the stage table, so the pill never needs a map.
      expect(row!.currentStageColour).toMatch(/^#[0-9a-f]{6}$/i);

      expect(row!.isOverdue).toBe(false);
      expect(row!.daysToCommitted).toBe(10);
    });
  });

  it("follows the latest stage event, not the last one inserted", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);

      // Entered afterwards, but it HAPPENED earlier. current_stage orders by
      // event_at, because Ajay updates stages in batches and the typing order
      // carries no information.
      await tx.execute(
        sql`insert into stage_event (po_item_id, stage_code, event_at)
            values (${s.itemId}, 'DESIGN', now() - interval '2 days')`,
      );

      const [row] = await tx
        .select()
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, s.itemId));

      expect(row!.currentStage).toBe("PRINTING");
    });
  });

  it("types a null committed date as null rather than failing (F8)", async () => {
    await inRollback(async (tx) => {
      const s = await scenario(tx);
      await tx.execute(
        sql`update po_item set committed_date = null where id = ${s.itemId}`,
      );

      const [row] = await tx
        .select()
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, s.itemId));

      expect(row!.committedDate).toBeNull();
      expect(row!.daysToCommitted).toBeNull();
      // Declared .notNull() in views.ts, and 0006 guarantees it.
      expect(row!.isOverdue).toBe(false);
      expect(row!.isAtRisk).toBe(false);
    });
  });
});
