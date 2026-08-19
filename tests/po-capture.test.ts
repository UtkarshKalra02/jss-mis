import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { auditedAppend, auditedInsert, SYSTEM_ACTOR } from "@/db/audit";
import { poItem, purchaseOrder, stageEvent } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";
import { startOfDayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import { inRollback, uniq } from "./helpers";

/**
 * PO capture, at the level the server action operates.
 *
 * The action itself needs a session and a request, so what is exercised here
 * is the sequence it performs: allocate, insert, append the opening event. The
 * invariant worth protecting is that those happen TOGETHER — an item with no
 * stage history is indistinguishable from one somebody forgot to update, and
 * the Item Tracker cannot tell you which.
 */

async function client(tx: Tx) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("P")}, 'PO Co') returning id`,
    )
  ).rows as { id: string }[];
  return c!.id;
}

/** What createPurchaseOrderAction does, minus the session. */
async function capture(
  tx: Tx,
  args: { clientId: string; poDate: string; committedDate: string | null; qty?: number },
) {
  const internalNo = await allocateNumber(tx, "PO", args.poDate);

  const po = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    { internalNo, clientId: args.clientId, poDate: args.poDate },
    tx,
  );

  const itemCode = await allocateNumber(tx, "ITM", args.poDate);

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode,
      purchaseOrderId: po.id,
      itemName: "Captured item",
      orderedQty: args.qty ?? 500,
      committedDate: args.committedDate,
    },
    tx,
  );

  await auditedAppend(
    SYSTEM_ACTOR,
    stageEvent,
    {
      poItemId: item.id,
      stageCode: "PO_RECEIVED",
      eventAt: startOfDayIST(args.poDate),
    },
    tx,
  );

  return { po, item };
}

describe("PO capture", () => {
  it("gives every new item an opening PO_RECEIVED stage", async () => {
    await inRollback(async (tx) => {
      const clientId = await client(tx);
      const { item } = await capture(tx, {
        clientId,
        poDate: "2026-08-18",
        committedDate: "2026-09-01",
      });

      const [row] = await tx
        .select()
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, item.id));

      // Not null — an item with no stage looks identical to a forgotten one.
      expect(row!.currentStage).toBe("PO_RECEIVED");
      expect(row!.pendingQty).toBe(500);
      expect(row!.status).toBe("Open");
    });
  });

  it("dates the opening event by the PO, not by the clock", async () => {
    // A PO entered three weeks late is three weeks old. Dating it now would
    // make every ageing figure derived from it wrong in the flattering
    // direction.
    await inRollback(async (tx) => {
      const clientId = await client(tx);
      const { item } = await capture(tx, {
        clientId,
        poDate: "2026-01-05",
        committedDate: "2026-02-01",
      });

      const [event] = await tx
        .select()
        .from(stageEvent)
        .where(eq(stageEvent.poItemId, item.id));

      // Midnight IST on 5 Jan is 18:30 UTC on 4 Jan. Asserting the UTC instant
      // is what proves the conversion happened rather than a naive parse.
      expect(event!.eventAt.toISOString()).toBe("2026-01-04T18:30:00.000Z");

      // created_at is when it was typed, and is deliberately different.
      expect(event!.createdAt.getTime()).toBeGreaterThan(event!.eventAt.getTime());
    });
  });

  it("numbers a backdated PO into the financial year it belongs to", async () => {
    await inRollback(async (tx) => {
      const clientId = await client(tx);
      const { po, item } = await capture(tx, {
        clientId,
        poDate: "2096-03-20",
        committedDate: "2096-04-10",
      });

      // 20 March 2096 is still FY 2095-96.
      expect(po.internalNo).toMatch(/^PO-2095-\d{4}$/);
      expect(item.itemCode).toMatch(/^ITM-2095-\d{5}$/);
    });
  });

  it("accepts a null committed date at the database, which only the importer uses", async () => {
    // The form requires one (non-negotiable 6). The column allows null so the
    // historical import can be honest, and such rows stay out of OTD (F8).
    await inRollback(async (tx) => {
      const clientId = await client(tx);
      const { item } = await capture(tx, {
        clientId,
        poDate: "2026-08-18",
        committedDate: null,
      });

      const [row] = await tx
        .select()
        .from(vPoItemStatus)
        .where(eq(vPoItemStatus.poItemId, item.id));

      expect(row!.committedDate).toBeNull();
      expect(row!.isOverdue).toBe(false);
      expect(row!.isAtRisk).toBe(false);
    });
  });

  it("rolls back the whole PO when one item fails", async () => {
    // The transaction is the point: a PO half-captured, with three of its five
    // items present, is worse than one that failed cleanly.
    await inRollback(async (tx) => {
      const clientId = await client(tx);

      let threw = false;
      try {
        await tx.transaction(async (sp) => {
          const internalNo = await allocateNumber(sp, "PO", "2026-08-18");
          const po = await auditedInsert(
            SYSTEM_ACTOR,
            purchaseOrder,
            { internalNo, clientId, poDate: "2026-08-18" },
            sp,
          );

          await auditedInsert(
            SYSTEM_ACTOR,
            poItem,
            {
              itemCode: await allocateNumber(sp, "ITM", "2026-08-18"),
              purchaseOrderId: po.id,
              itemName: "Good item",
              orderedQty: 10,
              committedDate: "2026-09-01",
            },
            sp,
          );

          // Violates po_item_ordered_qty_positive.
          await auditedInsert(
            SYSTEM_ACTOR,
            poItem,
            {
              itemCode: await allocateNumber(sp, "ITM", "2026-08-18"),
              purchaseOrderId: po.id,
              itemName: "Bad item",
              orderedQty: 0,
              committedDate: "2026-09-01",
            },
            sp,
          );
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);

      const survivors = await tx
        .select({ id: poItem.id })
        .from(poItem)
        .where(eq(poItem.itemName, "Good item"));
      expect(survivors).toHaveLength(0);
    });
  });
});
