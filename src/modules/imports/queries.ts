import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import { appUser, client, dispatch, importBatch, poItem, purchaseOrder } from "@/db/schema";

import { dedupeKey, type ClientLookup } from "./validate";

/**
 * Every live client, for name and code matching.
 *
 * Since F32 the importer may CREATE a client, but only where nothing in this
 * list resembles the typed name — so this list is what decides both whether a
 * row matches and whether creating is safe.
 */
export async function listClientsForImport(): Promise<ClientLookup[]> {
  return db
    .select({ id: client.id, code: client.code, name: client.name })
    .from(client)
    .where(isNull(client.deletedAt));
}

/**
 * Every (client, PO number, item name) already in the system.
 *
 * Built from live rows only, so a batch that was undone does not go on blocking
 * a re-import of the same file — undoing is meant to let you fix the
 * spreadsheet and try again.
 *
 * Includes rows typed by hand as well as imported ones. If Punit already
 * captured a PO that also appears in the historical file, importing it again
 * would produce two copies of the same order, and neither would be wrong enough
 * to notice.
 */
export async function existingDedupeKeys(): Promise<Set<string>> {
  const rows = await db
    .select({
      clientId: purchaseOrder.clientId,
      poNo: purchaseOrder.poNo,
      itemName: poItem.itemName,
    })
    .from(poItem)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, poItem.purchaseOrderId))
    .where(and(isNull(poItem.deletedAt), isNull(purchaseOrder.deletedAt)));

  return new Set(
    rows
      .filter((r) => r.poNo !== null)
      .map((r) => dedupeKey(r.clientId, r.poNo!, r.itemName)),
  );
}

/**
 * Codes already in use by a live client, lowercased.
 *
 * Read inside the write transaction, because a code generated for an
 * auto-created client (F32) has to be unique against what is in the database at
 * the moment of writing, not against what was on screen when the preview was
 * produced. `client_code_key` is a partial unique index over live rows (C5), so
 * a soft-deleted client's code is genuinely free and is not counted here.
 */
export async function liveClientCodes(tx: Tx): Promise<Set<string>> {
  const rows = await tx
    .select({ code: client.code })
    .from(client)
    .where(isNull(client.deletedAt));

  return new Set(rows.map((r) => r.code.toLowerCase()));
}

/**
 * An existing purchase order for this client and PO number, if there is one.
 *
 * Two imports of different items on the same client PO belong on ONE order, not
 * on two that share a number — so the importer attaches rather than duplicating.
 * Rows created by hand are reused too, and keep their null import_batch_id,
 * which is what stops an undo deleting an order somebody typed.
 */
export async function findPurchaseOrder(
  tx: Tx,
  clientId: string,
  poNo: string,
): Promise<{ id: string } | null> {
  const [row] = await tx
    .select({ id: purchaseOrder.id })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.clientId, clientId),
        eq(purchaseOrder.poNo, poNo),
        isNull(purchaseOrder.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** The same, for a challan number. */
export async function findDispatch(
  tx: Tx,
  clientId: string,
  challanNo: string,
): Promise<{ id: string } | null> {
  const [row] = await tx
    .select({ id: dispatch.id })
    .from(dispatch)
    .where(
      and(
        eq(dispatch.clientId, clientId),
        eq(dispatch.challanNo, challanNo),
        isNull(dispatch.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

export type BatchRow = {
  id: string;
  filename: string;
  createdAt: Date;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  importedByName: string | null;
  undoneAt: Date | null;
  undoneByName: string | null;
  /** Live rows still carrying this batch's id. Zero once it is undone. */
  liveItems: number;
};

/** Import History — spec requirement: batch, date, user, rows, undo. */
export async function listImportBatches(): Promise<BatchRow[]> {
  const rows = await db
    .select({
      id: importBatch.id,
      filename: importBatch.filename,
      createdAt: importBatch.createdAt,
      rowCount: importBatch.rowCount,
      importedCount: importBatch.importedCount,
      skippedCount: importBatch.skippedCount,
      importedById: importBatch.importedBy,
      undoneAt: importBatch.undoneAt,
      undoneById: importBatch.undoneBy,
      liveItems: sql<number>`(
        select count(*)::int from ${poItem}
        where ${poItem.importBatchId} = ${importBatch.id}
          and ${poItem.deletedAt} is null
      )`,
    })
    .from(importBatch)
    .where(isNull(importBatch.deletedAt))
    .orderBy(desc(importBatch.createdAt));

  // Two names per batch at most, from a table of six people — a lookup map is
  // cheaper and far more readable than joining app_user twice.
  const names = new Map(
    (await db.select({ id: appUser.id, name: appUser.name }).from(appUser)).map((u) => [
      u.id,
      u.name,
    ]),
  );

  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    createdAt: r.createdAt,
    rowCount: r.rowCount,
    importedCount: r.importedCount,
    skippedCount: r.skippedCount,
    importedByName: names.get(r.importedById) ?? null,
    undoneAt: r.undoneAt,
    undoneByName: r.undoneById ? (names.get(r.undoneById) ?? null) : null,
    liveItems: r.liveItems,
  }));
}

export async function getImportBatch(id: string) {
  const [row] = await db
    .select()
    .from(importBatch)
    .where(and(eq(importBatch.id, id), isNull(importBatch.deletedAt)))
    .limit(1);

  return row ?? null;
}
