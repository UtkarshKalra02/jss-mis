import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { appUser, client, design } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

import { totalsFor } from "./order-book";

export type DesignRow = {
  id: string;
  designCode: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  jobName: string;
  jobSize: string | null;
  paperType: string | null;
  gsm: string | null;
  approvalStatus: string;
  isActive: boolean;
};

/**
 * The grid. Live designs only — soft-deleted rows never appear
 * (non-negotiable 7).
 *
 * The client is joined rather than looked up per row: the grid shows a client
 * name on every line, and "which design is this?" is almost always asked as
 * "which of NAT's designs is this?".
 */
export async function listDesigns(): Promise<DesignRow[]> {
  return db
    .select({
      id: design.id,
      designCode: design.designCode,
      clientId: design.clientId,
      clientCode: client.code,
      clientName: client.name,
      jobName: design.jobName,
      jobSize: design.jobSize,
      paperType: design.paperType,
      gsm: design.gsm,
      approvalStatus: design.approvalStatus,
      isActive: design.isActive,
    })
    .from(design)
    .innerJoin(client, eq(client.id, design.clientId))
    .where(isNull(design.deletedAt))
    .orderBy(asc(design.designCode));
}

export async function getDesign(id: string) {
  const [row] = await db
    .select()
    .from(design)
    .where(and(eq(design.id, id), isNull(design.deletedAt)))
    .limit(1);

  return row ?? null;
}


/* -------------------------------------------------------------------------- */
/* The design's order book (P7)                                                */
/* -------------------------------------------------------------------------- */

export type OrderBookRow = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  purchaseOrderId: string;
  poInternalNo: string;
  clientPoNo: string | null;
  poAwaited: boolean;
  poDate: string;
  committedDate: string | null;
  status: string;
  currentStageName: string | null;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  isOverdue: boolean;
  isAtRisk: boolean;
};

export type OrderBook = {
  rows: OrderBookRow[];
  /** Totals across the rows above — summed here, stored nowhere. */
  ordered: number;
  dispatched: number;
  pending: number;
  /** How many of the rows still owe quantity. */
  openItems: number;
  overdue: number;
};

/**
 * Every PO item raised against one design, with the totals across them (P7).
 *
 * THE QUESTION THIS ANSWERS is the one N2 refused to answer by adding
 * quantities together on a single row: how much of this design does the
 * client have on order altogether, when the repeats are separate items? Here
 * the sum is a reading of the rows rather than a number written into one of
 * them — each item keeps its own quantity, its own promised date and its own
 * purchase order, which is exactly what N2 protects.
 *
 * A design belongs to one client, so a design's order book is already that
 * client's; there is no second filter to get wrong.
 *
 * Every figure comes from `v_po_item_status`, the same view the Item Tracker
 * and the repeat picker read, so "open" and "pending" mean here what they mean
 * everywhere else (non-negotiables 1 and 2).
 */
export async function orderBookForDesign(designId: string): Promise<OrderBook> {
  const rows = await db
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      purchaseOrderId: vPoItemStatus.purchaseOrderId,
      poInternalNo: vPoItemStatus.poInternalNo,
      clientPoNo: vPoItemStatus.clientPoNo,
      poAwaited: vPoItemStatus.poAwaited,
      poDate: vPoItemStatus.poDate,
      committedDate: vPoItemStatus.committedDate,
      status: vPoItemStatus.status,
      currentStageName: vPoItemStatus.currentStageName,
      orderedQty: vPoItemStatus.orderedQty,
      dispatchedQty: vPoItemStatus.dispatchedQty,
      pendingQty: vPoItemStatus.pendingQty,
      isOverdue: vPoItemStatus.isOverdue,
      isAtRisk: vPoItemStatus.isAtRisk,
    })
    .from(vPoItemStatus)
    .where(eq(vPoItemStatus.designId, designId))
    // Newest order first: what the client is running now is the live question.
    .orderBy(desc(vPoItemStatus.poDate), sql`${vPoItemStatus.committedDate} asc nulls last`);

  return { rows, ...totalsFor(rows) };
}

export type ClientOption = { id: string; code: string; name: string; isActive: boolean };

/**
 * Clients for the picker. Inactive ones are included but flagged, so editing a
 * design whose client was deactivated does not silently drop the selection.
 */
export async function listClientOptions(): Promise<ClientOption[]> {
  return db
    .select({
      id: client.id,
      code: client.code,
      name: client.name,
      isActive: client.isActive,
    })
    .from(client)
    .where(isNull(client.deletedAt))
    .orderBy(asc(client.name));
}

/**
 * The approver's name, for the detail screen.
 *
 * Read live rather than stored alongside the approval, because a name is
 * presentation and app_user is where it belongs. Usernames are immutable (E11)
 * so this cannot silently rewrite who approved something.
 */
export async function getApproverName(userId: string | null): Promise<string | null> {
  if (!userId) return null;

  const [row] = await db
    .select({ name: appUser.name })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);

  return row?.name ?? null;
}
