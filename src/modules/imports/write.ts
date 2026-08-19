import { and, eq, isNull } from "drizzle-orm";

import {
  auditedAppend,
  auditedInsert,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
  type Tx,
} from "@/db/audit";
import {
  dispatch,
  dispatchLine,
  importBatch,
  poItem,
  purchaseOrder,
  stageEvent,
} from "@/db/schema";
import { vPoItemStatus } from "@/db/views";
import { startOfDayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import { findDispatch, findPurchaseOrder } from "./queries";
import { importableRows, type ValidationResult } from "./validate";

/**
 * The importer's WRITE, separated from the server action around it.
 *
 * Split out so it can be exercised against a real database inside a rolled-back
 * transaction, without a session or an HTTP request. What it does is the part
 * worth testing — grouping rows into orders and challans, the minimal stage
 * history, and what an undo does and does not touch — and none of that is
 * reachable through an action that starts by asking who is signed in.
 *
 * Takes a transaction rather than opening one. The requirement is that an
 * import lands entirely or not at all: a part-written import is worse than a
 * failed one, because nobody knows how far it got and re-running duplicates
 * whatever did land.
 */
export async function writeImportBatch(
  actor: Actor,
  tx: Tx,
  args: { filename: string; result: ValidationResult },
): Promise<{ batchId: string; imported: number; completed: number; skipped: number }> {
  const { filename, result } = args;
  const toWrite = importableRows(result);

  const batch = await auditedInsert(
    actor,
    importBatch,
    {
      filename,
      rowCount: result.summary.total,
      importedCount: toWrite.length,
      skippedCount: result.summary.duplicate,
      importedBy: actor.id,
    },
    tx,
  );

  // Rows sharing a client and PO number are items on ONE order.
  const orders = new Map<string, string>();
  // Rows sharing a client and challan number go on ONE challan.
  const challans = new Map<string, { id: string; date: string }>();
  const touchedItems: { id: string; dispatchDate: string | null }[] = [];

  for (const row of toWrite) {
    const v = row.parsed!;

    let purchaseOrderId = orders.get(v.poKey);
    if (!purchaseOrderId) {
      // Attach to an order that already exists, whether it was imported
      // earlier or typed by hand. A hand-typed one keeps its null batch id,
      // which is what stops an undo deleting somebody's work.
      const existing = await findPurchaseOrder(tx, v.clientId, v.poNo);

      purchaseOrderId =
        existing?.id ??
        (
          await auditedInsert(
            actor,
            purchaseOrder,
            {
              internalNo: await allocateNumber(tx, "PO", v.poDate),
              poNo: v.poNo,
              clientId: v.clientId,
              poDate: v.poDate,
              importBatchId: batch.id,
            },
            tx,
          )
        ).id;

      orders.set(v.poKey, purchaseOrderId);
    }

    const item = await auditedInsert(
      actor,
      poItem,
      {
        itemCode: await allocateNumber(tx, "ITM", v.poDate),
        purchaseOrderId,
        itemName: v.itemName,
        orderedQty: v.orderedQty,
        rate: v.rate,
        // F8: null is legitimate here and ONLY here.
        committedDate: v.committedDate,
        importBatchId: batch.id,
      },
      tx,
    );

    // MINIMAL history, per the requirement: PO_RECEIVED at the PO date and
    // DISPATCHED at the dispatch date. Nothing in between is invented,
    // because nothing in between is known.
    await auditedAppend(
      actor,
      stageEvent,
      {
        poItemId: item.id,
        stageCode: "PO_RECEIVED",
        eventAt: startOfDayIST(v.poDate),
      },
      tx,
    );

    if (v.dispatchedQty > 0 && v.dispatchDate) {
      let challan = challans.get(v.challanKey!);

      if (!challan) {
        const existing = v.challanNo
          ? await findDispatch(tx, v.clientId, v.challanNo)
          : null;

        const id =
          existing?.id ??
          (
            await auditedInsert(
              actor,
              dispatch,
              {
                challanNo:
                  v.challanNo ?? (await allocateNumber(tx, "CH", v.dispatchDate)),
                clientId: v.clientId,
                dispatchDate: v.dispatchDate,
                // The goods went. A draft would consume nothing (F22) and
                // leave every historical job showing as still owed.
                status: "Dispatched",
                importBatchId: batch.id,
              },
              tx,
            )
          ).id;

        challan = { id, date: v.dispatchDate };
        challans.set(v.challanKey!, challan);
      }

      await auditedInsert(
        actor,
        dispatchLine,
        {
          dispatchId: challan.id,
          poItemId: item.id,
          qty: v.dispatchedQty,
          rate: v.rate,
          importBatchId: batch.id,
        },
        tx,
      );
    }

    touchedItems.push({ id: item.id, dispatchDate: v.dispatchDate });
  }

  // DISPATCHED is written only where the item ended up fully delivered —
  // the same rule the dispatch screen uses. Checked after every line is in,
  // because two rows can complete one item between them.
  let completed = 0;
  for (const touched of touchedItems) {
    if (!touched.dispatchDate) continue;

    const [status] = await tx
      .select({ pendingQty: vPoItemStatus.pendingQty })
      .from(vPoItemStatus)
      .where(eq(vPoItemStatus.poItemId, touched.id));

    if (status && status.pendingQty <= 0) {
      await auditedAppend(
        actor,
        stageEvent,
        {
          poItemId: touched.id,
          stageCode: "DISPATCHED",
          eventAt: startOfDayIST(touched.dispatchDate),
        },
        tx,
      );
      completed += 1;
    }
  }

  return {
    batchId: batch.id,
    imported: toWrite.length,
    completed,
    skipped: result.summary.duplicate,
  };
}

/**
 * Reverses a batch. Soft delete, and it cannot be anything else.
 *
 * stage_event is append-only, so the PO_RECEIVED and DISPATCHED events the
 * batch wrote cannot be removed. Soft-deleting the po_item rows takes them out
 * of v_po_item_status and every view built on it, leaving those events attached
 * to rows nothing displays — which is the right outcome. What was entered and
 * then withdrawn is exactly what an audit trail is for.
 *
 * Only rows CARRYING this batch's id are touched. An order the batch attached
 * to but did not create has a null import_batch_id and survives, along with
 * everything else on it.
 */
export async function undoImportBatch(
  actor: Actor,
  tx: Tx,
  batchId: string,
): Promise<{ lines: number; challans: number; items: number; orders: number }> {
  const lines = (
    await tx
      .select({ id: dispatchLine.id })
      .from(dispatchLine)
      .where(and(eq(dispatchLine.importBatchId, batchId), isNull(dispatchLine.deletedAt)))
  ).map((r) => r.id);

  const challans = (
    await tx
      .select({ id: dispatch.id })
      .from(dispatch)
      .where(and(eq(dispatch.importBatchId, batchId), isNull(dispatch.deletedAt)))
  ).map((r) => r.id);

  const items = (
    await tx
      .select({ id: poItem.id })
      .from(poItem)
      .where(and(eq(poItem.importBatchId, batchId), isNull(poItem.deletedAt)))
  ).map((r) => r.id);

  const orders = (
    await tx
      .select({ id: purchaseOrder.id })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.importBatchId, batchId), isNull(purchaseOrder.deletedAt)))
  ).map((r) => r.id);

  // Lines first, so the recompute triggers see quantities disappear before the
  // items they belong to; then challans, then items, then orders.
  for (const id of lines) await auditedSoftDelete(actor, dispatchLine, id, tx);
  for (const id of challans) await auditedSoftDelete(actor, dispatch, id, tx);
  for (const id of items) await auditedSoftDelete(actor, poItem, id, tx);
  for (const id of orders) await auditedSoftDelete(actor, purchaseOrder, id, tx);

  await auditedUpdate(
    actor,
    importBatch,
    batchId,
    { undoneAt: new Date(), undoneBy: actor.id },
    tx,
  );

  return {
    lines: lines.length,
    challans: challans.length,
    items: items.length,
    orders: orders.length,
  };
}
