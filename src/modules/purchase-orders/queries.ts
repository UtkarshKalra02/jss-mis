import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import { client, design, poItem, purchaseOrder } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

/**
 * "PO awaited" (N1), for queries that read purchase_order directly.
 *
 * The SAME expression migration 0038 put on v_po_item_status as `po_awaited`.
 * Item queries read the view's column; only reads that go to purchase_order
 * directly need it spelled out. Exported so they import it rather than write
 * a third copy. If the rule changes, it changes in the migration and here,
 * together.
 */
export const poAwaitedSql = sql<boolean>`(${purchaseOrder.poNo} is null and ${purchaseOrder.importBatchId} is null)`;

export type PurchaseOrderRow = {
  id: string;
  internalNo: string;
  poNo: string | null;
  poAwaited: boolean;
  clientCode: string;
  clientName: string;
  poDate: string;
  status: string;
  itemCount: number;
  openItems: number;
  orderValue: string;
};

/**
 * The PO grid.
 *
 * Item counts and value come from v_po_item_status rather than po_item, so the
 * "open" count means what the rest of the system means by open — the same
 * derived definition the Item Tracker and the dashboard will use. Counting
 * po_item.status here instead would be a second definition waiting to disagree.
 */
export async function listPurchaseOrders(): Promise<PurchaseOrderRow[]> {
  const items = db
    .select({
      purchaseOrderId: vPoItemStatus.purchaseOrderId,
      itemCount: sql<number>`count(*)::int`.as("item_count"),
      openItems:
        sql<number>`count(*) filter (where ${vPoItemStatus.status} = 'Open')::int`.as(
          "open_items",
        ),
      orderValue:
        sql<string>`coalesce(sum(${vPoItemStatus.orderedQty} * coalesce(${poItem.rate}, 0)), 0)`.as(
          "order_value",
        ),
    })
    .from(vPoItemStatus)
    .innerJoin(poItem, eq(poItem.id, vPoItemStatus.poItemId))
    .groupBy(vPoItemStatus.purchaseOrderId)
    .as("po_items");

  return db
    .select({
      id: purchaseOrder.id,
      internalNo: purchaseOrder.internalNo,
      poNo: purchaseOrder.poNo,
      poAwaited: poAwaitedSql,
      clientCode: client.code,
      clientName: client.name,
      poDate: purchaseOrder.poDate,
      status: purchaseOrder.status,
      itemCount: sql<number>`coalesce(${items.itemCount}, 0)::int`,
      openItems: sql<number>`coalesce(${items.openItems}, 0)::int`,
      orderValue: sql<string>`coalesce(${items.orderValue}, 0)::text`,
    })
    .from(purchaseOrder)
    .innerJoin(client, eq(client.id, purchaseOrder.clientId))
    .leftJoin(items, eq(items.purchaseOrderId, purchaseOrder.id))
    .where(isNull(purchaseOrder.deletedAt))
    .orderBy(desc(purchaseOrder.poDate), desc(purchaseOrder.internalNo));
}

export async function getPurchaseOrder(id: string) {
  const [row] = await db
    .select({
      id: purchaseOrder.id,
      internalNo: purchaseOrder.internalNo,
      poNo: purchaseOrder.poNo,
      poAwaited: poAwaitedSql,
      clientId: purchaseOrder.clientId,
      clientCode: client.code,
      clientName: client.name,
      poDate: purchaseOrder.poDate,
      fileUrl: purchaseOrder.fileUrl,
      notes: purchaseOrder.notes,
      status: purchaseOrder.status,
    })
    .from(purchaseOrder)
    .innerJoin(client, eq(client.id, purchaseOrder.clientId))
    .where(and(eq(purchaseOrder.id, id), isNull(purchaseOrder.deletedAt)))
    .limit(1);

  return row ?? null;
}

/**
 * The items on a PO, with everything derived.
 *
 * Reads the view, so pending_qty and current_stage come from the one place
 * they are defined (non-negotiables 1 and 2). The rate and remarks are joined
 * from po_item because they are stored facts about the order, not derived
 * ones, and the view has no business carrying them.
 */
export async function listPoItems(purchaseOrderId: string) {
  return db
    .select({
      id: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      orderedQty: vPoItemStatus.orderedQty,
      dispatchedQty: vPoItemStatus.dispatchedQty,
      pendingQty: vPoItemStatus.pendingQty,
      committedDate: vPoItemStatus.committedDate,
      daysToCommitted: vPoItemStatus.daysToCommitted,
      isOverdue: vPoItemStatus.isOverdue,
      isAtRisk: vPoItemStatus.isAtRisk,
      status: vPoItemStatus.status,
      priority: vPoItemStatus.priority,
      jobType: vPoItemStatus.jobType,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,
      rate: poItem.rate,
      remarks: poItem.remarks,
      designId: poItem.designId,
      designCode: design.designCode,
      designJobName: design.jobName,
    })
    .from(vPoItemStatus)
    .innerJoin(poItem, eq(poItem.id, vPoItemStatus.poItemId))
    .leftJoin(design, eq(design.id, poItem.designId))
    .where(eq(vPoItemStatus.purchaseOrderId, purchaseOrderId))
    .orderBy(asc(vPoItemStatus.itemCode));
}

export type PoItemRow = Awaited<ReturnType<typeof listPoItems>>[number];

export async function getPoItem(id: string) {
  const [row] = await db
    .select()
    .from(poItem)
    .where(and(eq(poItem.id, id), isNull(poItem.deletedAt)))
    .limit(1);

  return row ?? null;
}

/** Dispatched quantity for one item, from the single derived definition. */
export async function dispatchedQtyFor(poItemId: string): Promise<number> {
  const [row] = await db
    .select({ dispatchedQty: vPoItemStatus.dispatchedQty })
    .from(vPoItemStatus)
    .where(eq(vPoItemStatus.poItemId, poItemId))
    .limit(1);

  return row?.dispatchedQty ?? 0;
}

export type DesignOption = {
  id: string;
  designCode: string;
  jobName: string;
  clientId: string;
};

/**
 * Designs for the per-item picker, across every client.
 *
 * All of them are sent to the browser and filtered there by the client chosen
 * in the header, because the client can be changed after items are typed and a
 * round trip per change would make the form feel broken. Retired designs are
 * excluded — the point of retiring one is that it stops being selectable on new
 * work.
 */
export async function listDesignOptions(): Promise<DesignOption[]> {
  return db
    .select({
      id: design.id,
      designCode: design.designCode,
      jobName: design.jobName,
      clientId: design.clientId,
    })
    .from(design)
    .where(and(isNull(design.deletedAt), eq(design.isActive, true)))
    .orderBy(asc(design.designCode));
}

export type DuplicatePo = { internalNo: string; poDate: string };

/**
 * An existing PO with the same client PO number (decision F7).
 *
 * Warns, never blocks. Historical paper records repeat and mistype PO numbers,
 * and a uniqueness constraint would reject real data that genuinely exists —
 * so there is deliberately no database constraint behind this, only a question
 * asked once at the form.
 */
export async function findDuplicatePoNo(
  clientId: string,
  poNo: string,
  excludeId?: string,
): Promise<DuplicatePo | null> {
  const rows = await db
    .select({
      id: purchaseOrder.id,
      internalNo: purchaseOrder.internalNo,
      poDate: purchaseOrder.poDate,
    })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.clientId, clientId),
        eq(purchaseOrder.poNo, poNo),
        isNull(purchaseOrder.deletedAt),
      ),
    )
    .limit(2);

  const hit = rows.find((r) => r.id !== excludeId);
  return hit ? { internalNo: hit.internalNo, poDate: hit.poDate } : null;
}

/* -------------------------------------------------------------------------- */
/* Repeats, and orders an item can move to (N1, N2)                            */
/* -------------------------------------------------------------------------- */

export type OpenItemOption = {
  poItemId: string;
  clientId: string;
  itemCode: string;
  itemName: string;
  designId: string | null;
  designCode: string | null;
  rate: string | null;
  orderedQty: number;
  pendingQty: number;
  committedDate: string | null;
  poInternalNo: string;
  poAwaited: boolean;
};

/**
 * Every open item still owed quantity, across every client, for the "repeat
 * of…" list on the capture form (N2).
 *
 * All clients at once and filtered in the browser, for the reason
 * listDesignOptions gives: the client can be changed after rows are typed.
 * OPEN AND OWED ONLY — Utkarsh's call. What a client ordered last year is
 * reachable through the design picker; this list answers "what are we running
 * for them right now that they want more of".
 */
export async function listOpenItemOptions(): Promise<OpenItemOption[]> {
  return db
    .select({
      poItemId: vPoItemStatus.poItemId,
      clientId: vPoItemStatus.clientId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      designId: poItem.designId,
      designCode: design.designCode,
      rate: poItem.rate,
      orderedQty: vPoItemStatus.orderedQty,
      pendingQty: vPoItemStatus.pendingQty,
      committedDate: vPoItemStatus.committedDate,
      poInternalNo: vPoItemStatus.poInternalNo,
      poAwaited: vPoItemStatus.poAwaited,
    })
    .from(vPoItemStatus)
    .innerJoin(poItem, eq(poItem.id, vPoItemStatus.poItemId))
    .leftJoin(design, eq(design.id, poItem.designId))
    .where(and(eq(vPoItemStatus.status, "Open"), gt(vPoItemStatus.pendingQty, 0)))
    .orderBy(
      asc(vPoItemStatus.clientCode),
      sql`${vPoItemStatus.committedDate} asc nulls last`,
      asc(vPoItemStatus.itemCode),
    );
}

export type LinkablePurchaseOrder = {
  id: string;
  internalNo: string;
  poNo: string | null;
  poDate: string;
  status: string;
  poAwaited: boolean;
};

/**
 * The orders an item may be moved onto (N1): the same client's, not
 * cancelled, not the one it is already on.
 *
 * Closed orders are INCLUDED. The case this exists for is a PO that arrives
 * after delivery, and the PO it belongs on may well have closed on its other
 * items by then. The recompute trigger settles the status after the move.
 */
export async function listLinkablePurchaseOrders(
  clientId: string,
  excludeId: string,
): Promise<LinkablePurchaseOrder[]> {
  return db
    .select({
      id: purchaseOrder.id,
      internalNo: purchaseOrder.internalNo,
      poNo: purchaseOrder.poNo,
      poDate: purchaseOrder.poDate,
      status: purchaseOrder.status,
      poAwaited: poAwaitedSql,
    })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.clientId, clientId),
        ne(purchaseOrder.id, excludeId),
        ne(purchaseOrder.status, "Cancelled"),
        isNull(purchaseOrder.deletedAt),
      ),
    )
    .orderBy(desc(purchaseOrder.poDate), desc(purchaseOrder.internalNo));
}

/**
 * Live items left on an order — what decides whether an emptied one goes.
 * Takes the transaction, because the move that empties it has not committed
 * when the question is asked.
 */
export async function countLiveItems(purchaseOrderId: string, tx?: Tx): Promise<number> {
  const [row] = await (tx ?? db)
    .select({ n: sql<number>`count(*)::int` })
    .from(poItem)
    .where(and(eq(poItem.purchaseOrderId, purchaseOrderId), isNull(poItem.deletedAt)));

  return row?.n ?? 0;
}
