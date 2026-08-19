import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { client, design, poItem, purchaseOrder } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

export type PurchaseOrderRow = {
  id: string;
  internalNo: string;
  poNo: string | null;
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
