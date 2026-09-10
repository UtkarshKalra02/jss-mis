import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  appUser,
  design,
  dispatch,
  dispatchLine,
  jobCard,
  jobCardItem,
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
  /** Grouping keys off the id, not the code — two clients can share a name. */
  clientId: string;
  /** When the order came in. What the report's date range filters on (K17). */
  poDate: string;
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

/**
 * How the pending-work report orders its rows (K17).
 *
 * Applied in SQL rather than after grouping, so the row cap takes the top N by
 * the order somebody actually asked for — a limit applied to one ordering and
 * then re-sorted in the browser silently prints the wrong thousand rows.
 */
export type ItemSortKey = "urgency" | "itemCode" | "client" | "pendingQty" | "stage";

/** Sentinel for "no stage event yet", which no `IN` list can match. */
export const NO_STAGE = "__none__";

export async function searchItems(
  query: string,
  opts: {
    openOnly?: boolean;
    risk?: RiskFilter;
    limit?: number;
    /** Report filters (K17). All absent means the tracker's own behaviour. */
    clientIds?: readonly string[];
    /** Stage codes, or NO_STAGE for work that has not started. */
    stageCodes?: readonly string[];
    poDateFrom?: string;
    poDateTo?: string;
    sort?: ItemSortKey;
  } = {},
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
        // Through the junction since J25: a card may cover several items, and
        // searching its number must find every one of them.
        sql`exists (
          select 1 from ${jobCard}
          join ${jobCardItem} on ${jobCardItem.jobCardId} = ${jobCard.id}
          where ${jobCardItem.poItemId} = ${vPoItemStatus.poItemId}
            and ${jobCardItem.deletedAt} is null
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

  /*
   * REPORT FILTERS (K17). Each is absent unless the report asks for it, so the
   * Item Tracker's own call — which passes none of them — builds exactly the
   * query it always did.
   */
  const clients =
    opts.clientIds && opts.clientIds.length > 0
      ? inArray(vPoItemStatus.clientId, [...opts.clientIds])
      : undefined;

  /*
   * "Not started" cannot be expressed in an IN list, because its stage is
   * NULL. Ticking it alongside real stages has to mean "these stages OR no
   * stage at all", so the sentinel is split out and the two are ORed.
   */
  const wantsNoStage = opts.stageCodes?.includes(NO_STAGE) ?? false;
  const namedStages = (opts.stageCodes ?? []).filter((c) => c !== NO_STAGE);

  const stages =
    (opts.stageCodes?.length ?? 0) === 0
      ? undefined
      : or(
          namedStages.length > 0
            ? inArray(vPoItemStatus.currentStage, namedStages)
            : undefined,
          wantsNoStage ? isNull(vPoItemStatus.currentStage) : undefined,
        );

  // ON PO DATE, which is when the order came in — deliberately not the
  // committed date, which is what the "month due" grouping reads. The sheet
  // labels both so the two cannot be confused on paper.
  const poFrom = opts.poDateFrom ? gte(vPoItemStatus.poDate, opts.poDateFrom) : undefined;
  const poTo = opts.poDateTo ? lte(vPoItemStatus.poDate, opts.poDateTo) : undefined;

  /*
   * The default is the tracker's ordering and every other production screen's:
   * overdue first, then the nearest commitment. The alternatives exist for the
   * report and are each tie-broken by item code, so two rows that compare
   * equal do not swap places between two printings of the same sheet.
   */
  const byUrgency = [
    desc(vPoItemStatus.isOverdue),
    sql`${vPoItemStatus.committedDate} asc nulls last`,
    asc(vPoItemStatus.itemCode),
  ];

  const ordering =
    opts.sort === "itemCode"
      ? [asc(vPoItemStatus.itemCode)]
      : opts.sort === "client"
        ? [asc(vPoItemStatus.clientName), asc(vPoItemStatus.itemCode)]
        : opts.sort === "pendingQty"
          ? [desc(vPoItemStatus.pendingQty), asc(vPoItemStatus.itemCode)]
          : opts.sort === "stage"
            ? [
                sql`${vPoItemStatus.currentStageSequence} asc nulls first`,
                asc(vPoItemStatus.itemCode),
              ]
            : byUrgency;

  return db
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      poInternalNo: vPoItemStatus.poInternalNo,
      clientPoNo: vPoItemStatus.clientPoNo,
      clientId: vPoItemStatus.clientId,
      poDate: vPoItemStatus.poDate,
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
    .where(and(matches, openOnly, risk, clients, stages, poFrom, poTo))
    // Items with no committed date sort last under the default: NULLS LAST is
    // explicit because Postgres puts them first for ascending order, which
    // would push historical rows above live work.
    .orderBy(...ordering)
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

