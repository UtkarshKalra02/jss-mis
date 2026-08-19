import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { client, dispatch, dispatchLine, poItem } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

export type DispatchRow = {
  id: string;
  challanNo: string;
  clientCode: string;
  clientName: string;
  dispatchDate: string;
  status: string;
  lineCount: number;
  totalQty: number;
  vehicleNo: string | null;
};

export async function listDispatches(): Promise<DispatchRow[]> {
  const lines = db
    .select({
      dispatchId: dispatchLine.dispatchId,
      lineCount: sql<number>`count(*)::int`.as("line_count"),
      totalQty: sql<number>`coalesce(sum(${dispatchLine.qty}), 0)::int`.as("total_qty"),
    })
    .from(dispatchLine)
    .where(isNull(dispatchLine.deletedAt))
    .groupBy(dispatchLine.dispatchId)
    .as("dispatch_lines");

  return db
    .select({
      id: dispatch.id,
      challanNo: dispatch.challanNo,
      clientCode: client.code,
      clientName: client.name,
      dispatchDate: dispatch.dispatchDate,
      status: dispatch.status,
      lineCount: sql<number>`coalesce(${lines.lineCount}, 0)::int`,
      totalQty: sql<number>`coalesce(${lines.totalQty}, 0)::int`,
      vehicleNo: dispatch.vehicleNo,
    })
    .from(dispatch)
    .innerJoin(client, eq(client.id, dispatch.clientId))
    .leftJoin(lines, eq(lines.dispatchId, dispatch.id))
    .where(isNull(dispatch.deletedAt))
    .orderBy(desc(dispatch.dispatchDate), desc(dispatch.challanNo));
}

export async function getDispatch(id: string) {
  const [row] = await db
    .select({
      id: dispatch.id,
      challanNo: dispatch.challanNo,
      clientId: dispatch.clientId,
      clientCode: client.code,
      clientName: client.name,
      dispatchDate: dispatch.dispatchDate,
      vehicleNo: dispatch.vehicleNo,
      transporter: dispatch.transporter,
      ewayBillNo: dispatch.ewayBillNo,
      status: dispatch.status,
      remarks: dispatch.remarks,
    })
    .from(dispatch)
    .innerJoin(client, eq(client.id, dispatch.clientId))
    .where(and(eq(dispatch.id, id), isNull(dispatch.deletedAt)))
    .limit(1);

  return row ?? null;
}

/** The lines on one challan, with what the item looks like now. */
export async function listDispatchLines(dispatchId: string) {
  return db
    .select({
      id: dispatchLine.id,
      qty: dispatchLine.qty,
      rate: dispatchLine.rate,
      poItemId: dispatchLine.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      orderedQty: vPoItemStatus.orderedQty,
      dispatchedQty: vPoItemStatus.dispatchedQty,
      pendingQty: vPoItemStatus.pendingQty,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,
    })
    .from(dispatchLine)
    .innerJoin(vPoItemStatus, eq(vPoItemStatus.poItemId, dispatchLine.poItemId))
    .where(and(eq(dispatchLine.dispatchId, dispatchId), isNull(dispatchLine.deletedAt)))
    .orderBy(asc(vPoItemStatus.itemCode));
}

export type DispatchLineRow = Awaited<ReturnType<typeof listDispatchLines>>[number];

export type DispatchableItem = {
  poItemId: string;
  clientId: string;
  itemCode: string;
  itemName: string;
  poInternalNo: string;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  currentStage: string | null;
  currentStageName: string | null;
  currentStageColour: string | null;
  committedDate: string | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  rate: string | null;
};

/**
 * Items that can go on a challan.
 *
 * DECISION F2: every open item with pending_qty > 0, NOT only items at READY.
 * Spec 6.8 gates the screen on READY, and applied literally that would hide
 * precisely the rows Phase 2 exists to enter — backfilled historical jobs do
 * not arrive at READY, they arrive already delivered. The screen shows a
 * warning badge instead. Warn, never block.
 *
 * The rate is carried through so a dispatch line can default to the order's
 * rate rather than being retyped; it stays editable, because a delivery is
 * occasionally invoiced at a corrected rate.
 */
export async function listDispatchableItems(): Promise<DispatchableItem[]> {
  return db
    .select({
      poItemId: vPoItemStatus.poItemId,
      clientId: vPoItemStatus.clientId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      poInternalNo: vPoItemStatus.poInternalNo,
      orderedQty: vPoItemStatus.orderedQty,
      dispatchedQty: vPoItemStatus.dispatchedQty,
      pendingQty: vPoItemStatus.pendingQty,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,
      committedDate: vPoItemStatus.committedDate,
      isOverdue: vPoItemStatus.isOverdue,
      isAtRisk: vPoItemStatus.isAtRisk,
      rate: poItem.rate,
    })
    .from(vPoItemStatus)
    .innerJoin(poItem, eq(poItem.id, vPoItemStatus.poItemId))
    .where(and(eq(vPoItemStatus.status, "Open"), gt(vPoItemStatus.pendingQty, 0)))
    .orderBy(
      // Overdue first, then nearest commitment — the same order the tracker
      // uses, so the two screens agree about what is urgent.
      desc(vPoItemStatus.isOverdue),
      sql`${vPoItemStatus.committedDate} asc nulls last`,
      asc(vPoItemStatus.itemCode),
    );
}

/**
 * Items that would become fully dispatched by this challan.
 *
 * Read AFTER the lines are written, inside the same transaction, so it reflects
 * what the database now says rather than what the form intended. That is the
 * point: pending_qty is derived (non-negotiable 2), and asking the view is the
 * only way to be sure a partial delivery from last month has been accounted
 * for.
 */
export async function itemsNowComplete(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  poItemIds: string[],
): Promise<string[]> {
  if (poItemIds.length === 0) return [];

  const rows = await tx
    .select({
      poItemId: vPoItemStatus.poItemId,
      pendingQty: vPoItemStatus.pendingQty,
      currentStage: vPoItemStatus.currentStage,
    })
    .from(vPoItemStatus)
    .where(sql`${vPoItemStatus.poItemId} = any(${sql.param(poItemIds)}::uuid[])`);

  return rows
    .filter((r) => r.pendingQty <= 0 && r.currentStage !== "DISPATCHED")
    .map((r) => r.poItemId);
}
