import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { SYSTEM_ACTOR } from "@/db/audit";
import { client, poItem, purchaseOrder, stageEvent } from "@/db/schema";
import { vOtd, vPoItemStatus } from "@/db/views";
import {
  validateRows,
  type ClientDecisions,
  type ClientLookup,
  type RawRow,
} from "@/modules/imports/validate";
import { listImportBatches } from "@/modules/imports/queries";
import { undoImportBatch, writeImportBatch } from "@/modules/imports/write";

import { inRollback, uniq } from "./helpers";

/**
 * The importer's write path, against the real database.
 *
 * The validator is tested as a pure function elsewhere. What is checked here is
 * what the write actually produces: rows grouped into orders and challans, the
 * MINIMAL stage history the requirement asks for, and what an undo does and
 * does not touch.
 */

async function makeClient(tx: Tx, name: string): Promise<ClientLookup> {
  const code = uniq("IM");
  const [row] = (
    await tx.execute(
      sql`insert into client (code, name) values (${code}, ${name}) returning id`,
    )
  ).rows as { id: string }[];

  return { id: row!.id, code, name };
}

const rawRow = (over: Partial<RawRow>): RawRow => ({
  rowNumber: 4,
  clientName: "",
  poNo: "PO-1",
  poDate: "05/04/2026",
  itemName: "Outer carton",
  orderedQty: "1000",
  rate: "12.50",
  committedDate: "20/04/2026",
  dispatchDate: "18/04/2026",
  dispatchedQty: "1000",
  challanNo: "77",
  ...over,
});

/** Validate then write, the way the confirm action does. */
async function importRows(
  tx: Tx,
  rows: RawRow[],
  clients: ClientLookup[],
  existing: string[] = [],
  decisions: ClientDecisions = {},
) {
  const result = validateRows(rows, { clients, existingKeys: new Set(existing), decisions });
  expect(result.summary.error).toBe(0);

  return writeImportBatch(SYSTEM_ACTOR, tx, { filename: "historical.xlsx", result });
}

/** Live clients this batch created. */
async function clientsFromBatch(tx: Tx, batchId: string) {
  return tx
    .select({ id: client.id, code: client.code, name: client.name })
    .from(client)
    .where(and(eq(client.importBatchId, batchId), isNull(client.deletedAt)));
}

async function statusOf(tx: Tx, itemCode: string) {
  const [row] = await tx
    .select()
    .from(vPoItemStatus)
    .where(eq(vPoItemStatus.itemCode, itemCode));
  return row;
}

describe("import write", () => {
  it("creates the order, the item, the challan and a minimal stage history", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");
      const counts = await importRows(tx, [rawRow({ clientName: nat.name })], [nat]);

      expect(counts.imported).toBe(1);
      expect(counts.completed).toBe(1);

      const [item] = await tx
        .select({ id: poItem.id, itemCode: poItem.itemCode })
        .from(poItem)
        .where(eq(poItem.importBatchId, counts.batchId));

      const view = await statusOf(tx, item!.itemCode);
      expect(view!.orderedQty).toBe(1000);
      expect(view!.dispatchedQty).toBe(1000);
      expect(view!.pendingQty).toBe(0);
      // The recompute trigger closed it.
      expect(view!.status).toBe("Closed");

      // MINIMAL history: exactly two events, nothing invented in between.
      const events = await tx
        .select({ stageCode: stageEvent.stageCode, eventAt: stageEvent.eventAt })
        .from(stageEvent)
        .where(eq(stageEvent.poItemId, item!.id))
        .orderBy(stageEvent.eventAt);

      expect(events.map((e) => e.stageCode)).toEqual(["PO_RECEIVED", "DISPATCHED"]);
      // Dated by the paperwork, not by the import. Midnight IST on 5 April is
      // 18:30 UTC on 4 April.
      expect(events[0]!.eventAt.toISOString()).toBe("2026-04-04T18:30:00.000Z");
      expect(events[1]!.eventAt.toISOString()).toBe("2026-04-17T18:30:00.000Z");
    });
  });

  it("puts two items with the same PO number on ONE order", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");

      const counts = await importRows(
        tx,
        [
          rawRow({ rowNumber: 4, clientName: nat.name, itemName: "Outer carton" }),
          rawRow({ rowNumber: 5, clientName: nat.name, itemName: "Inner tray" }),
        ],
        [nat],
      );

      expect(counts.imported).toBe(2);

      const orders = await tx
        .select({ id: purchaseOrder.id })
        .from(purchaseOrder)
        .where(eq(purchaseOrder.importBatchId, counts.batchId));

      expect(orders).toHaveLength(1);

      const items = await tx
        .select({ id: poItem.id })
        .from(poItem)
        .where(eq(poItem.importBatchId, counts.batchId));

      expect(items).toHaveLength(2);
    });
  });

  it("attaches to an order that already exists rather than duplicating it", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");

      const first = await importRows(
        tx,
        [rawRow({ clientName: nat.name, itemName: "Outer carton" })],
        [nat],
      );

      const second = await importRows(
        tx,
        [rawRow({ rowNumber: 5, clientName: nat.name, itemName: "Inner tray" })],
        [nat],
      );

      // The second batch created no order of its own.
      const created = await tx
        .select({ id: purchaseOrder.id })
        .from(purchaseOrder)
        .where(eq(purchaseOrder.importBatchId, second.batchId));

      expect(created).toHaveLength(0);
      expect(first.batchId).not.toBe(second.batchId);

      const [order] = await tx
        .select({ id: purchaseOrder.id })
        .from(purchaseOrder)
        .where(eq(purchaseOrder.importBatchId, first.batchId));

      const items = await tx
        .select({ id: poItem.id })
        .from(poItem)
        .where(eq(poItem.purchaseOrderId, order!.id));

      expect(items).toHaveLength(2);
    });
  });

  it("keeps a job with no committed date out of OTD (F8)", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");

      const counts = await importRows(
        tx,
        [rawRow({ clientName: nat.name, committedDate: "" })],
        [nat],
      );

      const [item] = await tx
        .select({ id: poItem.id, itemCode: poItem.itemCode })
        .from(poItem)
        .where(eq(poItem.importBatchId, counts.batchId));

      const view = await statusOf(tx, item!.itemCode);
      expect(view!.committedDate).toBeNull();
      expect(view!.pendingQty).toBe(0);

      // Fully delivered, and still not an OTD data point in either direction.
      const otd = await tx.select().from(vOtd).where(eq(vOtd.poItemId, item!.id));
      expect(otd).toHaveLength(0);
    });
  });

  it("leaves a partly delivered job open with no DISPATCHED event", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");

      const counts = await importRows(
        tx,
        [rawRow({ clientName: nat.name, orderedQty: "1000", dispatchedQty: "400" })],
        [nat],
      );

      expect(counts.completed).toBe(0);

      const [item] = await tx
        .select({ id: poItem.id, itemCode: poItem.itemCode })
        .from(poItem)
        .where(eq(poItem.importBatchId, counts.batchId));

      expect((await statusOf(tx, item!.itemCode))!.pendingQty).toBe(600);

      const events = await tx
        .select({ stageCode: stageEvent.stageCode })
        .from(stageEvent)
        .where(eq(stageEvent.poItemId, item!.id));

      expect(events.map((e) => e.stageCode)).toEqual(["PO_RECEIVED"]);
    });
  });
});

describe("import write — clients (F32)", () => {
  it("creates a client nothing on file resembles, named exactly as typed", async () => {
    await inRollback(async (tx) => {
      const other = await makeClient(tx, uniq("Aarav Cartons "));
      const typed = `ZeNith Graphics ${uniq("")}`;

      const counts = await importRows(tx, [rawRow({ clientName: typed })], [other]);

      expect(counts.clientsCreated).toBe(1);

      const created = await clientsFromBatch(tx, counts.batchId);
      expect(created).toHaveLength(1);
      // Casing preserved. Normalising is for comparing, never for storing.
      expect(created[0]!.name).toBe(typed);
      expect(created[0]!.code).toMatch(/^[A-Z0-9-]{2,12}$/);
    });
  });

  it("puts two spellings of one new client on ONE client row", async () => {
    // Requirement 5, end to end.
    await inRollback(async (tx) => {
      const other = await makeClient(tx, uniq("Aarav Cartons "));
      const stem = uniq("Zenith");

      const counts = await importRows(
        tx,
        [
          rawRow({ rowNumber: 4, clientName: `${stem} Graphics`, poNo: "Z-1" }),
          rawRow({
            rowNumber: 5,
            clientName: `${stem.toUpperCase()} GRAPHICS PVT LTD`,
            poNo: "Z-2",
          }),
        ],
        [other],
      );

      expect(counts.clientsCreated).toBe(1);
      expect(await clientsFromBatch(tx, counts.batchId)).toHaveLength(1);

      // Both orders point at the same one.
      const orders = await tx
        .select({ clientId: purchaseOrder.clientId })
        .from(purchaseOrder)
        .where(eq(purchaseOrder.importBatchId, counts.batchId));

      expect(orders).toHaveLength(2);
      expect(new Set(orders.map((o) => o.clientId)).size).toBe(1);
    });
  });

  it("gives two genuinely different new clients different codes", async () => {
    // Both reduce to the same three letters, and the unique index is real: a
    // collision here would abort the whole import rather than misfile a row.
    await inRollback(async (tx) => {
      const other = await makeClient(tx, uniq("Aarav Cartons "));
      const stem = uniq("Zen");

      const counts = await importRows(
        tx,
        [
          // Distinct challan numbers: challan_no is unique across the whole
          // table, not per client, and these are two different customers.
          rawRow({ rowNumber: 4, clientName: `${stem}ith Graphics`, poNo: "Z-1", challanNo: uniq("C") }),
          rawRow({ rowNumber: 5, clientName: `${stem}obia Trading House`, poNo: "Z-2", challanNo: uniq("C") }),
        ],
        [other],
      );

      const created = await clientsFromBatch(tx, counts.batchId);
      expect(created).toHaveLength(2);
      expect(new Set(created.map((c) => c.code)).size).toBe(2);
    });
  });

  it("uses the existing client when the review is decided that way", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");

      const first = validateRows([rawRow({ clientName: "Nture Packging" })], {
        clients: [nat],
        existingKeys: new Set(),
      });
      expect(first.rows[0]!.status).toBe("review");

      const counts = await importRows(
        tx,
        [rawRow({ clientName: "Nture Packging" })],
        [nat],
        [],
        { [first.rows[0]!.review!.key]: nat.id },
      );

      // Nothing invented; the order went to the client that already existed.
      expect(counts.clientsCreated).toBe(0);
      expect(await clientsFromBatch(tx, counts.batchId)).toHaveLength(0);

      const [order] = await tx
        .select({ clientId: purchaseOrder.clientId })
        .from(purchaseOrder)
        .where(eq(purchaseOrder.importBatchId, counts.batchId));

      expect(order!.clientId).toBe(nat.id);
    });
  });
});

describe("import history — the live-row count that gates Undo", () => {
  it("counts the rows a batch still owns, so the Undo button appears", async () => {
    // This was 0 for every batch: the correlated subquery interpolated
    // unqualified column names, so `where "import_batch_id" = "id"` compared a
    // po_item against ITSELF inside `from po_item`. No error, no wrong screen —
    // just an Undo button that never rendered, which quietly removed the one
    // safety net a bad import has (F31).
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "History Count Co");

      const counts = await importRows(
        tx,
        [
          rawRow({ rowNumber: 4, clientName: nat.name, itemName: "Outer carton" }),
          rawRow({ rowNumber: 5, clientName: nat.name, itemName: "Inner tray" }),
        ],
        [nat],
      );

      const batches = await listImportBatches(tx);
      const mine = batches.find((b) => b.id === counts.batchId);

      expect(mine).toBeDefined();
      expect(mine!.liveItems).toBe(2);
    });
  });

  it("drops to zero once the batch is undone, so the button goes away", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "History Undone Co");
      const counts = await importRows(tx, [rawRow({ clientName: nat.name })], [nat]);

      expect(
        (await listImportBatches(tx)).find((b) => b.id === counts.batchId)!.liveItems,
      ).toBe(1);

      await undoImportBatch(SYSTEM_ACTOR, tx, counts.batchId);

      expect(
        (await listImportBatches(tx)).find((b) => b.id === counts.batchId)!.liveItems,
      ).toBe(0);
    });
  });
});

describe("import undo", () => {
  it("removes the batch's rows from every view, keeping the stage events", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");
      const counts = await importRows(tx, [rawRow({ clientName: nat.name })], [nat]);

      const [item] = await tx
        .select({ id: poItem.id, itemCode: poItem.itemCode })
        .from(poItem)
        .where(eq(poItem.importBatchId, counts.batchId));

      expect(await statusOf(tx, item!.itemCode)).toBeDefined();

      const removed = await undoImportBatch(SYSTEM_ACTOR, tx, counts.batchId);
      expect(removed).toMatchObject({ items: 1, orders: 1, challans: 1, lines: 1 });

      // Gone from the spine view, and therefore from every screen.
      expect(await statusOf(tx, item!.itemCode)).toBeUndefined();

      // The events survive — stage_event is append-only and cannot be deleted.
      // They are attached to a row nothing displays, which is the point.
      const events = await tx
        .select({ stageCode: stageEvent.stageCode })
        .from(stageEvent)
        .where(eq(stageEvent.poItemId, item!.id));

      expect(events).toHaveLength(2);
    });
  });

  it("does not touch an order the batch attached to but did not create", async () => {
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");

      const first = await importRows(
        tx,
        [rawRow({ clientName: nat.name, itemName: "Outer carton" })],
        [nat],
      );
      const second = await importRows(
        tx,
        [rawRow({ rowNumber: 5, clientName: nat.name, itemName: "Inner tray" })],
        [nat],
      );

      await undoImportBatch(SYSTEM_ACTOR, tx, second.batchId);

      // The order belongs to the FIRST batch and survives, with its own item.
      const orders = await tx
        .select({ id: purchaseOrder.id })
        .from(purchaseOrder)
        .where(
          and(eq(purchaseOrder.importBatchId, first.batchId), isNull(purchaseOrder.deletedAt)),
        );
      expect(orders).toHaveLength(1);

      const surviving = await tx
        .select({ id: poItem.id })
        .from(poItem)
        .where(and(eq(poItem.purchaseOrderId, orders[0]!.id), isNull(poItem.deletedAt)));
      expect(surviving).toHaveLength(1);
    });
  });

  it("removes a client the batch created, and keeps one it only matched", async () => {
    await inRollback(async (tx) => {
      const existing = await makeClient(tx, uniq("Aarav Cartons "));

      const counts = await importRows(
        tx,
        [
          rawRow({ rowNumber: 4, clientName: existing.name, poNo: "E-1", challanNo: uniq("C") }),
          rawRow({
            rowNumber: 5,
            clientName: `Zenith Graphics ${uniq("")}`,
            poNo: "Z-1",
            challanNo: uniq("C"),
          }),
        ],
        [existing],
      );

      expect(counts.clientsCreated).toBe(1);

      const removed = await undoImportBatch(SYSTEM_ACTOR, tx, counts.batchId);
      expect(removed.clients).toBe(1);

      // The invented one is gone from the client list...
      expect(await clientsFromBatch(tx, counts.batchId)).toHaveLength(0);

      // ...and the one that was already there survives, exactly as a
      // hand-typed purchase order does.
      const survivor = await tx
        .select({ id: client.id })
        .from(client)
        .where(and(eq(client.id, existing.id), isNull(client.deletedAt)));

      expect(survivor).toHaveLength(1);
    });
  });

  it("lets the same file be imported again after an undo", async () => {
    // Undo exists so a bad spreadsheet can be fixed and re-run. If the undone
    // rows went on matching the dedupe key, that would be impossible.
    await inRollback(async (tx) => {
      const nat = await makeClient(tx, "Nature Packaging");
      const rows = [rawRow({ clientName: nat.name })];

      const first = await importRows(tx, rows, [nat]);
      await undoImportBatch(SYSTEM_ACTOR, tx, first.batchId);

      // Dedupe keys are built from LIVE rows, so the undone ones block nothing.
      const second = await importRows(tx, rows, [nat]);
      expect(second.imported).toBe(1);
    });
  });
});
