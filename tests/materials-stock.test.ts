import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Migration 0039 — the store's arithmetic and its one guard (section O).
 *
 * Raw SQL, for the reason tests/po-status.test.ts gives: the claim is that
 * remaining is never stored and the guard holds against any writer.
 */

async function fixture(tx: Tx) {
  const [cat] = (
    await tx.execute(
      sql`insert into material_category (code, name) values (${uniq("C")}, 'Paper') returning id`,
    )
  ).rows as { id: string }[];
  const [typ] = (
    await tx.execute(
      sql`insert into material_type (code, name) values (${uniq("T")}, 'Sbs Paper') returning id`,
    )
  ).rows as { id: string }[];
  const [m] = (
    await tx.execute(
      sql`insert into material (sku, name, category_id, type_id, unit, gsm, size,
                                average_daily_consumption, lead_time_days, max_level)
          values (${uniq("P-T-")}, 'Sbs 23x36 300', ${cat!.id}, ${typ!.id}, 'Sheet', 300, '23X36',
                  50, 2, 1000) returning id`,
    )
  ).rows as { id: string }[];
  return { materialId: m!.id };
}

async function batch(tx: Tx, materialId: string, qty: number, date = "2026-09-01") {
  const [b] = (
    await tx.execute(
      sql`insert into material_batch (batch_no, material_id, received_date, qty_received)
          values (${uniq("B-")}, ${materialId}, ${date}, ${qty}) returning id`,
    )
  ).rows as { id: string }[];
  return b!.id;
}

async function remaining(tx: Tx, batchId: string): Promise<number> {
  const [r] = (
    await tx.execute(sql`select qty_remaining from v_material_batch_stock where batch_id = ${batchId}`)
  ).rows as { qty_remaining: string }[];
  return Number(r!.qty_remaining);
}

async function stock(tx: Tx, materialId: string) {
  const [r] = (
    await tx.execute(
      sql`select closing_stock, open_batches, reorder_level, days_remaining, needs_reorder
          from v_material_stock where material_id = ${materialId}`,
    )
  ).rows as {
    closing_stock: string;
    open_batches: number;
    reorder_level: string | null;
    days_remaining: string | null;
    needs_reorder: boolean;
  }[];
  return r!;
}

describe("batch remaining is arithmetic, not a column", () => {
  it("is received, less issued, plus signed adjustments", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      const b = await batch(tx, materialId, 500);
      expect(await remaining(tx, b)).toBe(500);

      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date, 120)`,
      );
      expect(await remaining(tx, b)).toBe(380);

      await tx.execute(
        sql`insert into material_adjustment (adjustment_no, batch_id, adjusted_on, qty, reason)
            values (${uniq("MA-")}, ${b}, current_date, -30, 'Damage')`,
      );
      expect(await remaining(tx, b)).toBe(350);

      await tx.execute(
        sql`insert into material_adjustment (adjustment_no, batch_id, adjusted_on, qty, reason)
            values (${uniq("MA-")}, ${b}, current_date, 10, 'Count correction')`,
      );
      expect(await remaining(tx, b)).toBe(360);
    });
  });

  it("stops counting an issue the moment it is soft-deleted", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      const b = await batch(tx, materialId, 100);
      const [i] = (
        await tx.execute(
          sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date, 40) returning id`,
        )
      ).rows as { id: string }[];
      expect(await remaining(tx, b)).toBe(60);

      await tx.execute(sql`update material_issue set deleted_at = now() where id = ${i!.id}`);
      expect(await remaining(tx, b)).toBe(100);
    });
  });
});

describe("closing stock and reorder flags", () => {
  it("sums live batches and counts the open ones; the typed max level is ignored since 0040", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      const a = await batch(tx, materialId, 300, "2026-08-01");
      await batch(tx, materialId, 700, "2026-09-01");
      // Empty the first batch entirely.
      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${a}, current_date, 300)`,
      );

      const s = await stock(tx, materialId);
      expect(Number(s.closing_stock)).toBe(700);
      expect(s.open_batches).toBe(1);
      // The fixture's typed max_level (1000) and ADC (50) are the columns
      // 0040 superseded: with the method left at On demand nothing is
      // derived and nothing is flagged, whatever those columns say (P2).
      expect(s.reorder_level).toBeNull();
      expect(s.needs_reorder).toBe(false);
    });
  });

  it("is not flagged when stock plus in-transit covers the derived level", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      await tx.execute(
        sql`update material set reorder_method = 'Consumption', safety_factor = 2, lead_time_days = 2, in_transit_qty = 200 where id = ${materialId}`,
      );
      const b = await batch(tx, materialId, 700);
      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date - 1, 90)`,
      );
      // ADC 1/day → max 4, level 3.2; 610 + 200 covers it comfortably.
      const s = await stock(tx, materialId);
      expect(s.needs_reorder).toBe(false);
    });
  });

  it("reads zero, not null, for a material with no batches at all", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      const s = await stock(tx, materialId);
      expect(Number(s.closing_stock)).toBe(0);
      expect(s.open_batches).toBe(0);
    });
  });
});

describe("an issue cannot take a batch below zero (0039 guard)", () => {
  it("refuses, names the batch and what is left, and says to adjust first", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      const b = await batch(tx, materialId, 100);
      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date, 90)`,
      );

      const result = await expectFailure(tx, (sp) =>
        sp.execute(
          sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date, 11)`,
        ),
      );
      expect(result.threw).toBe(true);
      expect(result.message).toContain("has only 10");
      expect(result.message).toContain("adjustment first");

      // Exactly what is left is fine.
      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date, 10)`,
      );
      expect(await remaining(tx, b)).toBe(0);
    });
  });

  it("re-checks when an existing issue's quantity is raised, without double-counting itself", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      const b = await batch(tx, materialId, 100);
      const [i] = (
        await tx.execute(
          sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date, 60) returning id`,
        )
      ).rows as { id: string }[];

      // 60 → 100 is exactly the batch; must pass (the old 60 is added back).
      await tx.execute(sql`update material_issue set qty = 100 where id = ${i!.id}`);
      expect(await remaining(tx, b)).toBe(0);

      const result = await expectFailure(tx, (sp) =>
        sp.execute(sql`update material_issue set qty = 101 where id = ${i!.id}`),
      );
      expect(result.threw).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 0040 — the sheet's Stock Intelligence, derived (P2)                         */
/* -------------------------------------------------------------------------- */

async function setMethod(tx: Tx, materialId: string, patch: string) {
  await tx.execute(sql.raw(`update material set ${patch} where id = '${materialId}'`));
}

async function intel(tx: Tx, materialId: string) {
  const [r] = (
    await tx.execute(
      sql`select stock_status, adc, max_level_calc, days_remaining, suggested_order_qty,
                 due_for_issue, days_to_issue, order_by_date
          from v_material_stock where material_id = ${materialId}`,
    )
  ).rows as {
    stock_status: string; adc: string | null; max_level_calc: string | null; days_remaining: string | null;
    suggested_order_qty: string; due_for_issue: boolean; days_to_issue: string | null; order_by_date: string | null;
  }[];
  return r!;
}

describe("reorder statuses follow the sheet's Calc Method (P2)", () => {
  it("an On-demand item computes nothing, whatever its stock", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      await setMethod(tx, materialId, "reorder_method = 'On demand'");
      const s = await intel(tx, materialId);
      expect(s.stock_status).toBe("On demand");
      expect(Number(s.suggested_order_qty)).toBe(0);
    });
  });

  it("a Consumption item derives ADC from issues in the window, and max level from ADC", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      // lead 2 days, factor 2 → max = adc × 4
      await setMethod(tx, materialId, "reorder_method = 'Consumption', safety_factor = 2, lead_time_days = 2");
      const b = await batch(tx, materialId, 1000);
      // 90 in the window (default 90 days) → ADC 1/day; max 4; stock 910 → OK.
      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date - 10, 90)`,
      );
      const s = await intel(tx, materialId);
      expect(Number(s.adc)).toBeCloseTo(1, 3);
      expect(Number(s.max_level_calc)).toBeCloseTo(4, 2);
      expect(Number(s.days_remaining)).toBeCloseTo(910, 0);
      expect(s.stock_status).toBe("OK");
    });
  });

  it("with nothing issued in the window it says so rather than pretending zero", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      await setMethod(tx, materialId, "reorder_method = 'Consumption', safety_factor = 2, lead_time_days = 2");
      await batch(tx, materialId, 100);
      expect((await intel(tx, materialId)).stock_status).toBe("No consumption data");
    });
  });

  it("flags Order now when stock covers less than the lead time, and suggests at least the MOQ", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      await setMethod(tx, materialId, "reorder_method = 'Consumption', safety_factor = 2, lead_time_days = 5, min_order_qty = 200");
      const b = await batch(tx, materialId, 1000);
      // 900 issued over the window → ADC 10/day; 100 left → 10 days > 5 lead → Low (100 < 0.8×100=80? no) …
      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date - 1, 960)`,
      );
      // ADC 960/90 = 10.67; left 40 → 3.75 days ≤ 5 → Order now; max = 10.67×5×2 = 106.7; suggest max(200, 106.7−40) = 200
      const s = await intel(tx, materialId);
      expect(s.stock_status).toBe("Order now");
      expect(Number(s.suggested_order_qty)).toBe(200);
      expect(s.order_by_date).not.toBeNull();
    });
  });

  it("an Interval item is due for issue once the last issue is older than its interval", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      await setMethod(tx, materialId, "reorder_method = 'Interval', issue_interval_days = 7");
      const b = await batch(tx, materialId, 100);
      await tx.execute(
        sql`insert into material_issue (issue_no, batch_id, issued_on, qty) values (${uniq("MI-")}, ${b}, current_date - 10, 5)`,
      );
      const s = await intel(tx, materialId);
      expect(s.stock_status).toBe("OK");
      expect(s.due_for_issue).toBe(true);
      expect(Number(s.days_to_issue)).toBe(-3);
    });
  });

  it("an Interval item with no interval says 'Set interval'; empty stock is Critical whatever the method", async () => {
    await inRollback(async (tx) => {
      const { materialId } = await fixture(tx);
      await setMethod(tx, materialId, "reorder_method = 'Interval', issue_interval_days = null, min_order_qty = 2");
      await batch(tx, materialId, 10);
      expect((await intel(tx, materialId)).stock_status).toBe("Set interval");
      // Empty it.
      const b2 = await batch(tx, materialId, 1);
      await tx.execute(sql`insert into material_adjustment (adjustment_no, batch_id, adjusted_on, qty, reason) values (${uniq("MA-")}, ${b2}, current_date, -11, 'Damage')`);
      const s = await intel(tx, materialId);
      expect(s.stock_status).toBe("Critical – order now");
      expect(Number(s.suggested_order_qty)).toBe(2);
    });
  });
});
