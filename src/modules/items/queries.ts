import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  appUser,
  design,
  dispatch,
  dispatchLine,
  jobCard,
  poItem,
  purchaseOrder,
  stage,
  stageEvent,
} from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

/**
 * The Item Tracker — spec 6.4, "the stop asking people screen".
 *
 * Everything derived is read from v_po_item_status, which is the whole point:
 * if this screen computed pending_qty or current_stage itself, there would be
 * two definitions and the screen people trust would be the one most likely to
 * disagree with the database (non-negotiables 1 and 2).
 */

export type ItemSearchRow = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  poInternalNo: string;
  clientPoNo: string | null;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  currentStage: string | null;
  currentStageName: string | null;
  currentStageColour: string | null;
  committedDate: string | null;
  daysToCommitted: number | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  status: string;
  priority: string;
};

/**
 * Search by item code, item name, client, PO number, or job card number
 * (spec 6.4).
 *
 * One query with ILIKE across the lot rather than a search box per field.
 * Somebody standing at a desk being asked "where is the Nature carton?" has a
 * fragment, not a field name — and does not know whether what they were told is
 * an item code or the client's PO number.
 *
 * Job card number is matched through an EXISTS rather than a join, so an item
 * with three job cards still returns once.
 */
export type RiskFilter = "overdue" | "at-risk";

export async function searchItems(
  query: string,
  opts: { openOnly?: boolean; risk?: RiskFilter; limit?: number } = {},
): Promise<ItemSearchRow[]> {
  const term = query.trim();
  const like = `%${term}%`;

  const matches = term
    ? or(
        ilike(vPoItemStatus.itemCode, like),
        ilike(vPoItemStatus.itemName, like),
        ilike(vPoItemStatus.clientCode, like),
        ilike(vPoItemStatus.clientName, like),
        ilike(vPoItemStatus.poInternalNo, like),
        ilike(vPoItemStatus.clientPoNo, like),
        sql`exists (
          select 1 from ${jobCard}
          where ${jobCard.poItemId} = ${vPoItemStatus.poItemId}
            and ${jobCard.deletedAt} is null
            and ${jobCard.jcNo} ilike ${like}
        )`,
      )
    : undefined;

  const openOnly = opts.openOnly ? eq(vPoItemStatus.status, "Open") : undefined;

  /*
   * The dashboard's Overdue and At-risk tiles link here (spec 6.1 asks for
   * "count + clickable list"), so the two screens have to agree about what the
   * words mean. They do, because both read the same column: is_overdue and
   * is_at_risk are computed once in v_po_item_status and re-derived nowhere.
   *
   * At-risk in particular is not a fixed three days — the window is a setting
   * the Admin screen can change (B3) — so a filter written as date arithmetic
   * here would silently stop matching the tile the moment somebody edited it.
   */
  const risk =
    opts.risk === "overdue"
      ? eq(vPoItemStatus.isOverdue, true)
      : opts.risk === "at-risk"
        ? eq(vPoItemStatus.isAtRisk, true)
        : undefined;

  return db
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      poInternalNo: vPoItemStatus.poInternalNo,
      clientPoNo: vPoItemStatus.clientPoNo,
      orderedQty: vPoItemStatus.orderedQty,
      dispatchedQty: vPoItemStatus.dispatchedQty,
      pendingQty: vPoItemStatus.pendingQty,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,
      committedDate: vPoItemStatus.committedDate,
      daysToCommitted: vPoItemStatus.daysToCommitted,
      isOverdue: vPoItemStatus.isOverdue,
      isAtRisk: vPoItemStatus.isAtRisk,
      status: vPoItemStatus.status,
      priority: vPoItemStatus.priority,
    })
    .from(vPoItemStatus)
    .where(and(matches, openOnly, risk))
    // Overdue first, then the nearest commitment. Items with no committed date
    // sort last: NULLS LAST is explicit because Postgres puts them first for
    // ascending order, which would push historical rows above live work.
    .orderBy(
      desc(vPoItemStatus.isOverdue),
      sql`${vPoItemStatus.committedDate} asc nulls last`,
      asc(vPoItemStatus.itemCode),
    )
    .limit(opts.limit ?? 200);
}

/** The item itself, with everything derived. Null when it does not exist. */
export async function getItemStatus(poItemId: string) {
  const [row] = await db
    .select()
    .from(vPoItemStatus)
    .where(eq(vPoItemStatus.poItemId, poItemId))
    .limit(1);

  return row ?? null;
}

/** Stored facts the view has no business carrying. */
export async function getItemDetail(poItemId: string) {
  const [row] = await db
    .select({
      rate: poItem.rate,
      remarks: poItem.remarks,
      committedDateBasis: poItem.committedDateBasis,
      designId: poItem.designId,
      designCode: design.designCode,
      designJobName: design.jobName,
      designApprovalStatus: design.approvalStatus,
      poNotes: purchaseOrder.notes,
      poFileUrl: purchaseOrder.fileUrl,
    })
    .from(poItem)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, poItem.purchaseOrderId))
    .leftJoin(design, eq(design.id, poItem.designId))
    .where(and(eq(poItem.id, poItemId), isNull(poItem.deletedAt)))
    .limit(1);

  return row ?? null;
}

export type TimelineEntry = {
  id: string;
  stageCode: string;
  stageName: string | null;
  stageColour: string | null;
  eventAt: Date;
  createdAt: Date;
  enteredByName: string | null;
  remarks: string | null;
  jobCardNo: string | null;
};

/**
 * The full stage timeline, newest first.
 *
 * Every event, never a summary. stage_event is append-only, so a correction
 * appears as a further row rather than replacing the wrong one — which means
 * the timeline occasionally shows a job going backwards, and that is the
 * truth rather than a rendering bug. Backward moves are permitted deliberately
 * (F4): rework is real on a shop floor.
 *
 * event_at and created_at are both returned because they are different facts.
 * event_at is when it happened; created_at is when somebody typed it. The gap
 * is routine — Ajay updates in batches — and is sometimes the evidence that
 * settles an OTD dispute.
 */
export async function getItemTimeline(poItemId: string): Promise<TimelineEntry[]> {
  return db
    .select({
      id: stageEvent.id,
      stageCode: stageEvent.stageCode,
      stageName: stage.name,
      stageColour: stage.colour,
      eventAt: stageEvent.eventAt,
      createdAt: stageEvent.createdAt,
      enteredByName: appUser.name,
      remarks: stageEvent.remarks,
      jobCardNo: jobCard.jcNo,
    })
    .from(stageEvent)
    .leftJoin(stage, eq(stage.code, stageEvent.stageCode))
    .leftJoin(appUser, eq(appUser.id, stageEvent.enteredBy))
    .leftJoin(jobCard, eq(jobCard.id, stageEvent.jobCardId))
    .where(eq(stageEvent.poItemId, poItemId))
    .orderBy(desc(stageEvent.eventAt), desc(stageEvent.createdAt), desc(stageEvent.id));
}

export type ItemDispatch = {
  id: string;
  challanNo: string;
  dispatchDate: string;
  qty: number;
  rate: string | null;
  status: string;
  vehicleNo: string | null;
};

/** Linked dispatches (spec 6.4). Cancelled challans are shown, marked. */
export async function getItemDispatches(poItemId: string): Promise<ItemDispatch[]> {
  return db
    .select({
      id: dispatch.id,
      challanNo: dispatch.challanNo,
      dispatchDate: dispatch.dispatchDate,
      qty: dispatchLine.qty,
      rate: dispatchLine.rate,
      status: dispatch.status,
      vehicleNo: dispatch.vehicleNo,
    })
    .from(dispatchLine)
    .innerJoin(dispatch, eq(dispatch.id, dispatchLine.dispatchId))
    .where(
      and(
        eq(dispatchLine.poItemId, poItemId),
        isNull(dispatchLine.deletedAt),
        isNull(dispatch.deletedAt),
      ),
    )
    .orderBy(desc(dispatch.dispatchDate));
}

/*
 * Job cards for an item used to be read here, and are now read by
 * `jobCardsForItem` in src/modules/job-cards/queries.ts.
 *
 * Moved rather than duplicated when job card release was built (J1). This
 * version returned four columns for a table that could never render, because
 * nothing in the system created a card; the job-cards module owns the read now
 * and returns what actually ran as well as what was planned. Two queries
 * answering "which cards does this item have" is exactly how the two stop
 * agreeing.
 */

