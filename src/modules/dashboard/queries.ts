import { and, eq, gt, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import { dispatch, dispatchLine, poItem, stage } from "@/db/schema";
import { vPoItemStatus, vOtd } from "@/db/views";

/**
 * The dashboard's numbers — spec 6.1.
 *
 * EVERY WINDOW IN THIS FILE GOES THROUGH `today_ist()`, never a JavaScript
 * date (C10). "The last 30 days" and "this month" are day-boundary
 * comparisons, and a server asking a UTC clock what today is gets the wrong
 * answer for four and a half hours every night — which is exactly when a late
 * dispatch would move across the boundary and change OTD.
 *
 * NOTHING HERE COMPUTES A METRIC A VIEW ALREADY DEFINES. OTD comes from
 * `v_otd`, overdue and at-risk from `v_po_item_status`. The one figure with no
 * view behind it is dispatched-this-month, because it needs a monetary value
 * and no view carries one; it is written against `dispatch_line` here and
 * nowhere else.
 */

type Runner = typeof db | Tx;

/** Below this many deliveries in EITHER window, no trend is claimed. */
export const MIN_FOR_TREND = 5;

/** The rolling window, in days, on both sides of the comparison. */
const WINDOW_DAYS = 30;

export type OtdWindow = {
  total: number;
  onTime: number;
  /** Null when the window holds no deliveries at all — never 0. */
  percent: number | null;
};

export type OtdSummary = {
  current: OtdWindow;
  previous: OtdWindow;
  /**
   * Percentage points, current minus previous. NULL when either window is too
   * thin to compare — see MIN_FOR_TREND.
   */
  changePoints: number | null;
};

function windowOf(total: number, onTime: number): OtdWindow {
  return {
    total,
    onTime,
    // A window with no deliveries has no percentage. Returning 0 would be a
    // claim about performance where the truth is "nothing was delivered".
    percent: total === 0 ? null : (onTime / total) * 100,
  };
}

/**
 * On-time delivery over the last 30 days, and the 30 before that.
 *
 * `v_otd` already excludes items with no committed date (F8) and cancelled
 * ones, so nothing here re-filters: an item nobody made a promise about is not
 * a delivery-performance data point in either direction, and that rule lives in
 * one place.
 *
 * Both windows come back from ONE query with FILTER clauses rather than two
 * round trips, so they cannot straddle a midnight between them.
 */
export async function otdSummary(runner: Runner = db): Promise<OtdSummary> {
  const currentFrom = sql`today_ist() - ${WINDOW_DAYS}::integer`;
  const previousFrom = sql`today_ist() - ${WINDOW_DAYS * 2}::integer`;

  const [row] = await runner
    .select({
      currentTotal: sql<number>`count(*) filter (
        where ${vOtd.fulfilmentDate} >= ${currentFrom}
      )::int`,
      currentOnTime: sql<number>`count(*) filter (
        where ${vOtd.fulfilmentDate} >= ${currentFrom} and ${vOtd.onTime}
      )::int`,
      previousTotal: sql<number>`count(*) filter (
        where ${vOtd.fulfilmentDate} >= ${previousFrom}
          and ${vOtd.fulfilmentDate} < ${currentFrom}
      )::int`,
      previousOnTime: sql<number>`count(*) filter (
        where ${vOtd.fulfilmentDate} >= ${previousFrom}
          and ${vOtd.fulfilmentDate} < ${currentFrom}
          and ${vOtd.onTime}
      )::int`,
    })
    .from(vOtd);

  const current = windowOf(row?.currentTotal ?? 0, row?.currentOnTime ?? 0);
  const previous = windowOf(row?.previousTotal ?? 0, row?.previousOnTime ?? 0);

  /*
   * NO ARROW ON THIN DATA. Two deliveries against one is not a trend, and an
   * arrow is read as one — it would swing wildly week to week on a factory
   * doing forty jobs a month and train everybody to ignore it. Both windows
   * have to carry real volume before a direction is claimed.
   */
  const comparable =
    current.percent !== null &&
    previous.percent !== null &&
    current.total >= MIN_FOR_TREND &&
    previous.total >= MIN_FOR_TREND;

  return {
    current,
    previous,
    changePoints: comparable ? current.percent! - previous.percent! : null,
  };
}

export type WorkloadCounts = {
  overdue: number;
  atRisk: number;
  /** Open items with quantity still owed, whatever stage they are at. */
  open: number;
  /** Of those, the ones sitting at a stage that is actual floor work (F18). */
  inProduction: number;
};

/**
 * Overdue, at risk, and how much is actually on the floor.
 *
 * "In production" counts items whose current stage has `is_process = true`.
 * That flag is what separates work happening to PAPER from points in an
 * order's life (F18), so an item sitting at PO_RECEIVED or READY is open but
 * is not in production — which is the distinction somebody reading the tile
 * is asking about.
 *
 * Overdue and at-risk are NOT recomputed here. Both are columns on
 * `v_po_item_status`, both are guaranteed non-null by migration 0006, and the
 * at-risk window is a setting the Admin screen can change (B3) — reproducing
 * either rule in this file is how the dashboard and the item list start
 * disagreeing about what is urgent.
 */
export async function workloadCounts(runner: Runner = db): Promise<WorkloadCounts> {
  const [row] = await runner
    .select({
      overdue: sql<number>`count(*) filter (where ${vPoItemStatus.isOverdue})::int`,
      atRisk: sql<number>`count(*) filter (where ${vPoItemStatus.isAtRisk})::int`,
      open: sql<number>`count(*) filter (
        where ${vPoItemStatus.status} = 'Open' and ${vPoItemStatus.pendingQty} > 0
      )::int`,
      inProduction: sql<number>`count(*) filter (
        where ${vPoItemStatus.status} = 'Open'
          and ${vPoItemStatus.pendingQty} > 0
          and ${stage.isProcess}
      )::int`,
    })
    .from(vPoItemStatus)
    .leftJoin(stage, eq(stage.code, vPoItemStatus.currentStage));

  return {
    overdue: row?.overdue ?? 0,
    atRisk: row?.atRisk ?? 0,
    open: row?.open ?? 0,
    inProduction: row?.inProduction ?? 0,
  };
}

export type DispatchedThisMonth = {
  items: number;
  challans: number;
  /** Rupees. Null when nothing has gone out at all. */
  value: number | null;
  /** Lines whose quantity is counted but whose value could not be. */
  linesWithoutRate: number;
};

/**
 * What left the building this calendar month — spec 6.1's "value + item count".
 *
 * THE ONE FIGURE ON THE DASHBOARD WITH NO VIEW BEHIND IT, because no view
 * carries money. It follows `v_po_item_status`'s own rules about which
 * challans count: soft-deleted and Cancelled ones consume nothing (F22), so
 * they are excluded here in exactly the same terms.
 *
 * The rate falls back from the dispatch line to the PO item, because a line
 * usually carries no rate of its own and the item's is the right one. Lines
 * with neither are COUNTED in the item total and reported separately rather
 * than being silently valued at zero — a total that quietly omits revenue is
 * worse than one that says how much it could not see.
 */
export async function dispatchedThisMonth(
  runner: Runner = db,
): Promise<DispatchedThisMonth> {
  const [row] = await runner
    .select({
      items: sql<number>`count(distinct ${dispatchLine.poItemId})::int`,
      challans: sql<number>`count(distinct ${dispatch.id})::int`,
      value: sql<string | null>`sum(
        ${dispatchLine.qty} * coalesce(${dispatchLine.rate}, ${poItem.rate}, 0)
      )`,
      linesWithoutRate: sql<number>`count(*) filter (
        where ${dispatchLine.rate} is null and ${poItem.rate} is null
      )::int`,
    })
    .from(dispatchLine)
    .innerJoin(dispatch, eq(dispatch.id, dispatchLine.dispatchId))
    .innerJoin(poItem, eq(poItem.id, dispatchLine.poItemId))
    .where(
      and(
        sql`${dispatchLine.deletedAt} is null`,
        sql`${dispatch.deletedAt} is null`,
        sql`${dispatch.status} <> 'Cancelled'`,
        // The calendar month in IST, so a challan dated the 1st does not land
        // in the previous month for anybody reading before 5.30am.
        sql`${dispatch.dispatchDate} >= date_trunc('month', today_ist())::date`,
      ),
    );

  return {
    items: row?.items ?? 0,
    challans: row?.challans ?? 0,
    value: row?.value === null || row?.value === undefined ? null : Number(row.value),
    linesWithoutRate: row?.linesWithoutRate ?? 0,
  };
}

export type WipStage = {
  code: string;
  name: string | null;
  colour: string | null;
  sequence: number | null;
  items: number;
};

/**
 * WIP by stage — spec 6.1's horizontal bar.
 *
 * Counts only, deliberately. `v_wip_ageing` can also say which items are over
 * their stage's target hours, and that is NOT shown here: every seeded target
 * is an unmeasured placeholder (A2), so an "over target" bar would be a
 * confident red claim derived from a number nobody has ever checked. It
 * becomes worth showing on the day the targets are measured.
 *
 * Items with no stage event at all are excluded rather than bucketed as
 * "unknown". F19 makes that state unreachable for anything captured through
 * the app — every item is born with a PO_RECEIVED event — so a bucket for it
 * would be a permanently empty category on the busiest chart on the screen.
 */
export async function wipByStage(runner: Runner = db): Promise<WipStage[]> {
  return runner
    .select({
      code: vPoItemStatus.currentStage,
      name: vPoItemStatus.currentStageName,
      colour: vPoItemStatus.currentStageColour,
      sequence: vPoItemStatus.currentStageSequence,
      items: sql<number>`count(*)::int`,
    })
    .from(vPoItemStatus)
    .where(
      and(
        eq(vPoItemStatus.status, "Open"),
        gt(vPoItemStatus.pendingQty, 0),
        isNotNull(vPoItemStatus.currentStage),
      ),
    )
    .groupBy(
      vPoItemStatus.currentStage,
      vPoItemStatus.currentStageName,
      vPoItemStatus.currentStageColour,
      vPoItemStatus.currentStageSequence,
    )
    .orderBy(vPoItemStatus.currentStageSequence) as Promise<WipStage[]>;
}
