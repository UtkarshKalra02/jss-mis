import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { searchItems } from "@/modules/items/queries";

import { inRollback, uniq } from "./helpers";

/**
 * The Item Tracker's search (spec 6.4).
 *
 * `searchItems` reads the live database rather than a transaction, so these
 * tests COMMIT nothing — they set their fixtures up inside a rolled-back
 * transaction and query through the same transaction by rebuilding the search
 * there. What is actually asserted is the SQL: which columns match, and how
 * results are ordered.
 *
 * The ordering matters more than it looks. An item with no committed date sorts
 * last by an explicit NULLS LAST, because Postgres puts nulls FIRST in
 * ascending order — without it, every historical import row would sit above
 * live work on the screen people use to answer "where is this?".
 */

async function fixture(tx: Tx) {
  const clientCode = uniq("SRCH");

  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${clientCode}, 'Search Client Ltd') returning id`,
    )
  ).rows as { id: string }[];

  const poNo = uniq("CPO-");
  const [po] = (
    await tx.execute(
      sql`insert into purchase_order (internal_no, po_no, client_id, po_date)
          values (${uniq("PO-")}, ${poNo}, ${c!.id}, current_date) returning id`,
    )
  ).rows as { id: string }[];

  const mk = async (name: string, committed: string | null) => {
    const [row] = (
      await tx.execute(
        sql`insert into po_item (item_code, purchase_order_id, item_name, ordered_qty, committed_date)
            values (${uniq("ITM-")}, ${po!.id}, ${name}, 100, ${committed}) returning id, item_code`,
      )
    ).rows as { id: string; item_code: string }[];
    return row!;
  };

  return {
    clientCode,
    poNo,
    overdue: await mk("Overdue carton", "2020-01-01"),
    soon: await mk("Soon carton", "2099-01-01"),
    later: await mk("Later carton", "2099-06-01"),
    historical: await mk("Historical carton", null),
  };
}

/** The same query searchItems builds, run inside the test's transaction. */
async function search(tx: Tx, term: string) {
  const like = `%${term}%`;
  const result = await tx.execute(sql`
    select v.item_code, v.item_name
    from v_po_item_status v
    where (
      v.item_code ilike ${like}
      or v.item_name ilike ${like}
      or v.client_code ilike ${like}
      or v.client_name ilike ${like}
      or v.po_internal_no ilike ${like}
      or v.client_po_no ilike ${like}
      or exists (
        select 1 from job_card jc
        where jc.po_item_id = v.po_item_id
          and jc.deleted_at is null
          and jc.jc_no ilike ${like}
      )
    )
    and v.status = 'Open'
    order by v.is_overdue desc, v.committed_date asc nulls last, v.item_code asc
  `);
  return result.rows as { item_code: string; item_name: string }[];
}

describe("item search", () => {
  it("matches on client code", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const rows = await search(tx, f.clientCode);
      expect(rows).toHaveLength(4);
    });
  });

  it("matches on the client's own PO number", async () => {
    // The number somebody is most likely to be reading off a piece of paper,
    // and the one they are least likely to know is not ours.
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const rows = await search(tx, f.poNo);
      expect(rows).toHaveLength(4);
    });
  });

  it("matches on a fragment of the item name, case-insensitively", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const rows = await search(tx, "OVERDUE cart");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.item_code).toBe(f.overdue.item_code);
    });
  });

  it("matches on a job card number without duplicating the item", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const jcNo = uniq("JC-");

      // Two cards on one item. A join would return it twice.
      await tx.execute(
        sql`insert into job_card (jc_no, po_item_id) values (${jcNo}, ${f.soon.id})`,
      );
      await tx.execute(
        sql`insert into job_card (jc_no, po_item_id) values (${uniq("JC-")}, ${f.soon.id})`,
      );

      const rows = await search(tx, jcNo);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.item_code).toBe(f.soon.item_code);
    });
  });

  it("puts overdue first, then the nearest commitment, with no-commitment last", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const rows = await search(tx, f.clientCode);

      expect(rows.map((r) => r.item_code)).toEqual([
        f.overdue.item_code,
        f.soon.item_code,
        f.later.item_code,
        // NULLS LAST. Postgres would otherwise sort this one FIRST, putting
        // every imported historical row above live work.
        f.historical.item_code,
      ]);
    });
  });
});

describe("searchItems", () => {
  it("returns nothing for a term that matches nothing", async () => {
    // Exercises the real function, including its Drizzle query construction —
    // the tests above check the SQL semantics, this checks it compiles and runs.
    const rows = await searchItems("zzz-no-such-item-zzz");
    expect(rows).toEqual([]);
  });
});
