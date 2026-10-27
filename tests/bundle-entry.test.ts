import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { grnLineSchema, issueSchema } from "@/modules/materials/validation";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Receiving and issuing in bundles (V1).
 *
 * "5 bundles of 460 came." The ledger still stores 2,300 — the bundle figures
 * record HOW that total was arrived at, and neither the form nor the database
 * will let them disagree with it.
 *
 * Both layers are tested because they are not the same guarantee. The schema
 * is what produces a sentence somebody can act on; the check constraint is
 * what makes the rule true regardless of which door the row came through
 * (non-negotiable 4).
 */
describe("bundle entry — the form's rule", () => {
  const line = (over: Record<string, unknown> = {}) =>
    grnLineSchema.safeParse({
      materialId: "3f1a1c2e-0000-4000-8000-000000000001",
      qty: "2300",
      bundles: "5",
      sheetsPerBundle: "460",
      ...over,
    });

  it("accepts 5 bundles of 460 against 2,300", () => {
    expect(line().success).toBe(true);
  });

  it("accepts loose stock with neither figure", () => {
    expect(line({ bundles: "", sheetsPerBundle: "", qty: "1234" }).success).toBe(true);
  });

  it("refuses a total that does not match, and says what it should be", () => {
    const r = line({ qty: "2000" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.message).toBe("5 × 460 is 2300, not 2000.");
    }
  });

  it("refuses one bundle figure without the other, either way round", () => {
    expect(line({ sheetsPerBundle: "" }).success).toBe(false);
    expect(line({ bundles: "" }).success).toBe(false);
  });

  it("applies the same rule when issuing", () => {
    const issue = (over: Record<string, unknown> = {}) =>
      issueSchema.safeParse({
        batchId: "3f1a1c2e-0000-4000-8000-000000000002",
        issuedOn: "2026-10-27",
        qty: "2300",
        bundles: "5",
        sheetsPerBundle: "460",
        ...over,
      });

    expect(issue().success).toBe(true);
    expect(issue({ qty: "2301" }).success).toBe(false);
    expect(issue({ bundles: "", sheetsPerBundle: "" }).success).toBe(true);
  });
});

describe("bundle entry — the database's rule", () => {
  /** A paper material with one GRN, ready to receive against. */
  async function paperAndGrn(tx: Parameters<Parameters<typeof inRollback>[0]>[0]) {
    const [cat] = (
      await tx.execute(sql`
        insert into material_category (code, name) values (${uniq("C")}, 'Bundle Cat')
        returning id`)
    ).rows as { id: string }[];
    const [typ] = (
      await tx.execute(
        sql`insert into material_type (code, name) values (${uniq("T")}, 'Bundle Type') returning id`,
      )
    ).rows as { id: string }[];
    const [mat] = (
      await tx.execute(sql`
        insert into material (sku, name, category_id, type_id, unit)
        values (${uniq("P-BND-")}, 'Bundle Paper', ${cat!.id}, ${typ!.id}, 'Sheet')
        returning id`)
    ).rows as { id: string }[];
    const [g] = (
      await tx.execute(sql`
        insert into grn (grn_no, received_date, vendor)
        values (${uniq("GRN-")}, today_ist(), 'Mill') returning id`)
    ).rows as { id: string }[];
    return { materialId: mat!.id, grnId: g!.id };
  }

  const insertBatch = (
    tx: Parameters<Parameters<typeof inRollback>[0]>[0],
    ids: { materialId: string; grnId: string },
    qty: string,
    bundles: number | null,
    per: number | null,
  ) =>
    tx.execute(sql`
      insert into material_batch (batch_no, grn_id, material_id, received_date, qty_received, bundles, sheets_per_bundle)
      values (${uniq("B-")}, ${ids.grnId}, ${ids.materialId}, today_ist(), ${qty}, ${bundles}, ${per})`);

  it("stores the sheets, with how they were counted beside them", async () => {
    await inRollback(async (tx) => {
      const ids = await paperAndGrn(tx);
      await insertBatch(tx, ids, "2300", 5, 460);

      const rows = (
        await tx.execute(sql`
          select qty_received::int as qty, bundles, sheets_per_bundle
          from material_batch where material_id = ${ids.materialId}`)
      ).rows as { qty: number; bundles: number; sheets_per_bundle: number }[];

      // The ledger figure is the atomic one — everything downstream reads it.
      expect(rows[0]).toMatchObject({ qty: 2300, bundles: 5, sheets_per_bundle: 460 });
    });
  });

  it("refuses a total that disagrees with the bundles", async () => {
    await inRollback(async (tx) => {
      const ids = await paperAndGrn(tx);
      const r = await expectFailure(tx, (sp) => insertBatch(sp, ids, "2000", 5, 460));
      expect(r.threw).toBe(true);
      expect(r.message).toContain("material_batch_bundles_agree");
    });
  });

  it("refuses half a pair", async () => {
    await inRollback(async (tx) => {
      const ids = await paperAndGrn(tx);
      expect((await expectFailure(tx, (sp) => insertBatch(sp, ids, "2300", 5, null))).threw).toBe(
        true,
      );
      expect((await expectFailure(tx, (sp) => insertBatch(sp, ids, "2300", null, 460))).threw).toBe(
        true,
      );
    });
  });

  it("leaves loose stock alone", async () => {
    await inRollback(async (tx) => {
      const ids = await paperAndGrn(tx);
      await insertBatch(tx, ids, "1234", null, null);
      const rows = (
        await tx.execute(sql`
          select count(*)::int as n from material_batch
          where material_id = ${ids.materialId} and bundles is null`)
      ).rows as { n: number }[];
      expect(rows[0]!.n).toBe(1);
    });
  });
});

describe("the manual bundle on a job card — the database's rule", () => {
  it("refuses a fixed bundle carrying a size, and a manual one without", async () => {
    await inRollback(async (tx) => {
      const [c] = (
        await tx.execute(
          sql`insert into client (code, name) values (${uniq("BC")}, 'Bundle Co') returning id`,
        )
      ).rows as { id: string }[];
      const [po] = (
        await tx.execute(sql`
          insert into purchase_order (internal_no, client_id, po_date)
          values (${uniq("PO-")}, ${c!.id}, today_ist()) returning id`)
      ).rows as { id: string }[];
      const [item] = (
        await tx.execute(sql`
          insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
          values (${uniq("ITM-")}, ${po!.id}, 'Bundle item', 1000, today_ist()) returning id`)
      ).rows as { id: string }[];

      const card = (bundle: string, per: number | null) =>
        tx.execute(sql`
          insert into job_card (jc_no, paper_qty, paper_bundle, paper_sheets_per_bundle)
          values (${uniq("JC-")}, 5, ${bundle}, ${per})`);

      // A Packet is 100 sheets and always was (J18). A size beside it would be
      // a second number claiming to be the same fact.
      expect((await expectFailure(tx, () => card("Packet", 460))).threw).toBe(true);

      // And a manual bundle with no size counts nothing at all.
      expect((await expectFailure(tx, () => card("Bundle", null))).threw).toBe(true);

      void item;
    });
  });
});
