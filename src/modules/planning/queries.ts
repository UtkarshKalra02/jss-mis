import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import {
  dispatch,
  dispatchLine,
  jobCard,
  jobCardItem,
  machine,
  planEntry,
  pressRun,
  stage,
} from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

/**
 * Reads for the job planning board — spec 6.6, decision M1.
 *
 * THE BOARD PLANS PO ITEMS. A job card is often raised on the morning the job
 * runs, so the card is shown on the row when one exists and is never a
 * prerequisite. Every figure that describes the item — stage, pending
 * quantity, urgency — is read from `v_po_item_status`, so the board's red and
 * amber are the Item Tracker's (non-negotiables 1 and 2). The only thing read
 * from `plan_entry` is the decision the meeting made.
 */

type Runner = typeof db | Tx;

export type PlanKind = "Production" | "Dispatch";

/** One open item on the left panel. */
export type PlanItemRow = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  poInternalNo: string;
  orderedQty: number;
  pendingQty: number;
  committedDate: string | null;
  daysToCommitted: number | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  currentStage: string | null;
  currentStageName: string | null;
  currentStageColour: string | null;
  currentStageSequence: number | null;

  /** The item's latest live card, when it has one. */
  jobCardId: string | null;
  jcNo: string | null;
  machineName: string | null;

  /** The plate that card is on, when ganged — so the board can collapse it (H8). */
  pressRunId: string | null;
  runNo: string | null;
  runDate: string | null;
  runMachine: string | null;

  /** Days from today on which this item is already on a plan, ascending. */
  productionDates: string[];
  dispatchDates: string[];
};

/** Splits Postgres's array_to_string output; empty string is no dates. */
function dates(csv: string | null): string[] {
  if (!csv) return [];
  return [...new Set(csv.split(",").filter(Boolean))];
}

/**
 * Every open item with quantity owed — the left panel.
 *
 * Ordered the way every worklist in this system is: overdue first, then the
 * nearest commitment (F22), so a plate carrying an overdue job inherits that
 * position when the board collapses it.
 *
 * Each row carries the days it is ALREADY planned on, from today forward, so
 * the meeting can see "this is on Tuesday's press list" without opening
 * Tuesday. Past plans are history and are not shown here.
 */
export async function itemsToPlan(runner: Runner = db): Promise<PlanItemRow[]> {
  /*
   * The item's latest live card, one row per item. An item may have several
   * (split and repeat runs, spec section 3); DISTINCT ON keeps the most
   * recently planned, then most recently raised. Cancelled cards do not
   * count as cover (J12).
   */
  const card = runner
    .selectDistinctOn([jobCardItem.poItemId], {
      poItemId: jobCardItem.poItemId,
      // Aliased, because drizzle renders a subquery's columns by their table
      // names and two tables here have an `id` (H7's cousin).
      jobCardId: sql<string>`${jobCard.id}`.as("job_card_id"),
      jcNo: jobCard.jcNo,
      machineName: machine.name,
      pressRunId: sql<string | null>`${pressRun.id}`.as("press_run_id"),
      runNo: pressRun.runNo,
      runDate: pressRun.runDate,
      runMachine: pressRun.machine,
    })
    .from(jobCardItem)
    .innerJoin(jobCard, eq(jobCard.id, jobCardItem.jobCardId))
    .leftJoin(machine, eq(machine.id, jobCard.machineId))
    .leftJoin(pressRun, and(eq(pressRun.id, jobCard.pressRunId), isNull(pressRun.deletedAt)))
    .where(
      and(isNull(jobCardItem.deletedAt), isNull(jobCard.deletedAt), ne(jobCard.status, "Cancelled")),
    )
    .orderBy(
      jobCardItem.poItemId,
      sql`${jobCard.plannedDate} desc nulls last`,
      desc(jobCard.createdAt),
    )
    .as("card");

  const plans = runner
    .select({
      poItemId: planEntry.poItemId,
      productionDates: sql<string | null>`array_to_string(
        array_agg(${planEntry.planDate} order by ${planEntry.planDate})
          filter (where ${planEntry.kind} = 'Production'), ','
      )`.as("production_dates"),
      dispatchDates: sql<string | null>`array_to_string(
        array_agg(${planEntry.planDate} order by ${planEntry.planDate})
          filter (where ${planEntry.kind} = 'Dispatch'), ','
      )`.as("dispatch_dates"),
    })
    .from(planEntry)
    .where(and(isNull(planEntry.deletedAt), sql`${planEntry.planDate} >= today_ist()`))
    .groupBy(planEntry.poItemId)
    .as("plans");

  const rows = await runner
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      poInternalNo: vPoItemStatus.poInternalNo,
      orderedQty: vPoItemStatus.orderedQty,
      pendingQty: vPoItemStatus.pendingQty,
      committedDate: vPoItemStatus.committedDate,
      daysToCommitted: vPoItemStatus.daysToCommitted,
      isOverdue: vPoItemStatus.isOverdue,
      isAtRisk: vPoItemStatus.isAtRisk,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,
      currentStageSequence: vPoItemStatus.currentStageSequence,
      jobCardId: card.jobCardId,
      jcNo: card.jcNo,
      machineName: card.machineName,
      pressRunId: card.pressRunId,
      runNo: card.runNo,
      runDate: card.runDate,
      runMachine: card.runMachine,
      productionDates: plans.productionDates,
      dispatchDates: plans.dispatchDates,
    })
    .from(vPoItemStatus)
    .leftJoin(card, eq(card.poItemId, vPoItemStatus.poItemId))
    .leftJoin(plans, eq(plans.poItemId, vPoItemStatus.poItemId))
    .where(and(eq(vPoItemStatus.status, "Open"), gt(vPoItemStatus.pendingQty, 0)))
    .orderBy(
      desc(vPoItemStatus.isOverdue),
      sql`${vPoItemStatus.committedDate} asc nulls last`,
      asc(vPoItemStatus.itemCode),
    );

  return rows.map((r) => ({
    ...r,
    productionDates: dates(r.productionDates),
    dispatchDates: dates(r.dispatchDates),
  }));
}

/** One line of a day's plan, with the item it is about. */
export type PlanEntryRow = {
  entryId: string;
  planDate: string;
  kind: PlanKind;
  sequence: number;
  plannedQty: number | null;
  notes: string | null;

  /** Where the meeting said the job goes. Null for Dispatch. */
  stageCode: string | null;
  stageName: string | null;
  stageColour: string | null;
  stageSequence: number | null;
  machineName: string | null;

  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  poInternalNo: string;
  pendingQty: number;
  itemStatus: string;
  committedDate: string | null;
  daysToCommitted: number | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  currentStage: string | null;
  currentStageName: string | null;
  currentStageColour: string | null;

  jcNo: string | null;
  jobCardId: string | null;
};

/**
 * What is planned for one day, both kinds — the right panel and the printed
 * floor plan read this and nothing else.
 *
 * Ordered by kind, then the planned station's sequence, then the order the
 * meeting put them in. Entries whose item has since been delivered or closed
 * are still returned: a plan is a record of what was decided, and the row
 * says so through the item's status and pending quantity.
 */
export async function dayPlan(date: string, runner: Runner = db): Promise<PlanEntryRow[]> {
  const card = runner
    .selectDistinctOn([jobCardItem.poItemId], {
      poItemId: jobCardItem.poItemId,
      jobCardId: jobCard.id,
      jcNo: jobCard.jcNo,
    })
    .from(jobCardItem)
    .innerJoin(jobCard, eq(jobCard.id, jobCardItem.jobCardId))
    .where(
      and(isNull(jobCardItem.deletedAt), isNull(jobCard.deletedAt), ne(jobCard.status, "Cancelled")),
    )
    .orderBy(
      jobCardItem.poItemId,
      sql`${jobCard.plannedDate} desc nulls last`,
      desc(jobCard.createdAt),
    )
    .as("card");

  return runner
    .select({
      entryId: planEntry.id,
      planDate: planEntry.planDate,
      kind: planEntry.kind,
      sequence: planEntry.sequence,
      plannedQty: planEntry.plannedQty,
      notes: planEntry.notes,

      stageCode: planEntry.stageCode,
      stageName: stage.name,
      stageColour: stage.colour,
      stageSequence: stage.sequence,
      machineName: machine.name,

      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      poInternalNo: vPoItemStatus.poInternalNo,
      pendingQty: vPoItemStatus.pendingQty,
      itemStatus: vPoItemStatus.status,
      committedDate: vPoItemStatus.committedDate,
      daysToCommitted: vPoItemStatus.daysToCommitted,
      isOverdue: vPoItemStatus.isOverdue,
      isAtRisk: vPoItemStatus.isAtRisk,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,

      jcNo: card.jcNo,
      jobCardId: card.jobCardId,
    })
    .from(planEntry)
    .innerJoin(vPoItemStatus, eq(vPoItemStatus.poItemId, planEntry.poItemId))
    .leftJoin(stage, eq(stage.code, planEntry.stageCode))
    .leftJoin(machine, eq(machine.id, planEntry.machineId))
    .leftJoin(card, eq(card.poItemId, planEntry.poItemId))
    .where(and(eq(planEntry.planDate, date), isNull(planEntry.deletedAt)))
    .orderBy(
      asc(planEntry.kind),
      sql`${stage.sequence} asc nulls last`,
      asc(planEntry.sequence),
      asc(planEntry.createdAt),
    ) as Promise<PlanEntryRow[]>;
}

/**
 * Production entries per day between two dates — the strip under the day
 * picker, so "tomorrow is full, push it to Thursday" is decided from the
 * screen rather than by paging through the week.
 */
export async function plannedCountsBetween(
  from: string,
  to: string,
  runner: Runner = db,
): Promise<Map<string, { production: number; dispatch: number }>> {
  const rows = await runner
    .select({
      planDate: planEntry.planDate,
      production: sql<number>`count(*) filter (where ${planEntry.kind} = 'Production')::int`,
      dispatch: sql<number>`count(*) filter (where ${planEntry.kind} = 'Dispatch')::int`,
    })
    .from(planEntry)
    .where(
      and(isNull(planEntry.deletedAt), sql`${planEntry.planDate} between ${from} and ${to}`),
    )
    .groupBy(planEntry.planDate);

  return new Map(rows.map((r) => [r.planDate, { production: r.production, dispatch: r.dispatch }]));
}

/** The raw entry, for actions that check before writing. */
export async function getPlanEntry(id: string, runner: Runner = db) {
  const [row] = await runner
    .select()
    .from(planEntry)
    .where(and(eq(planEntry.id, id), isNull(planEntry.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Live entries of one day and kind, in order — what a move re-sequences. */
export async function siblingsOf(
  date: string,
  kind: PlanKind,
  runner: Runner = db,
): Promise<{ id: string; sequence: number }[]> {
  return runner
    .select({ id: planEntry.id, sequence: planEntry.sequence })
    .from(planEntry)
    .where(and(eq(planEntry.planDate, date), eq(planEntry.kind, kind), isNull(planEntry.deletedAt)))
    .orderBy(asc(planEntry.sequence), asc(planEntry.createdAt));
}

/**
 * The items an add is about, with their pending quantity — which is what a
 * Dispatch entry's quantity defaults to (M3). One query for the batch.
 *
 * Ids are filtered to uuids first, for the reason `releasableItemsByIds`
 * gives: a non-uuid in an `in (...)` against a uuid column throws 22P02
 * rather than matching nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function itemsByIds(poItemIds: readonly string[], runner: Runner = db) {
  const ids = [...new Set(poItemIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0) return [];
  return runner
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      status: vPoItemStatus.status,
      pendingQty: vPoItemStatus.pendingQty,
    })
    .from(vPoItemStatus)
    .where(inArray(vPoItemStatus.poItemId, ids));
}

/* -------------------------------------------------------------------------- */
/* The dispatch plan, for the dashboard                                        */
/* -------------------------------------------------------------------------- */

export type DispatchPlanLine = {
  entryId: string;
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  plannedQty: number | null;
  /** Pieces actually on a Dispatched challan dated that day. */
  goneQty: number;
  currentStageName: string | null;
  isAtRisk: boolean;
};

/**
 * The hand-picked dispatch list for one day, with what has actually gone.
 *
 * "Gone" is the sum of Dispatched (not Draft, not Cancelled — F22) challan
 * lines for the item dated that day, so the dashboard can tick a line off
 * without anybody marking it: the challan IS the tick.
 */
export async function dispatchPlanFor(
  date: string,
  runner: Runner = db,
): Promise<DispatchPlanLine[]> {
  const gone = runner
    .select({
      poItemId: dispatchLine.poItemId,
      qty: sql<number>`coalesce(sum(${dispatchLine.qty}), 0)::int`.as("gone_qty"),
    })
    .from(dispatchLine)
    .innerJoin(dispatch, eq(dispatch.id, dispatchLine.dispatchId))
    .where(
      and(
        isNull(dispatchLine.deletedAt),
        isNull(dispatch.deletedAt),
        eq(dispatch.status, "Dispatched"),
        eq(dispatch.dispatchDate, date),
      ),
    )
    .groupBy(dispatchLine.poItemId)
    .as("gone");

  return runner
    .select({
      entryId: planEntry.id,
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      plannedQty: planEntry.plannedQty,
      goneQty: sql<number>`coalesce(${gone.qty}, 0)::int`,
      currentStageName: vPoItemStatus.currentStageName,
      isAtRisk: vPoItemStatus.isAtRisk,
    })
    .from(planEntry)
    .innerJoin(vPoItemStatus, eq(vPoItemStatus.poItemId, planEntry.poItemId))
    .leftJoin(gone, eq(gone.poItemId, planEntry.poItemId))
    .where(
      and(eq(planEntry.planDate, date), eq(planEntry.kind, "Dispatch"), isNull(planEntry.deletedAt)),
    )
    .orderBy(asc(planEntry.sequence), asc(planEntry.createdAt));
}

/**
 * The next production day an item is planned for, today or later — so a job
 * card released for a planned item is born with that date (M1).
 */
export async function nextPlannedDateFor(
  poItemId: string,
  runner: Runner = db,
): Promise<string | null> {
  const [row] = await runner
    .select({ planDate: planEntry.planDate })
    .from(planEntry)
    .where(
      and(
        eq(planEntry.poItemId, poItemId),
        eq(planEntry.kind, "Production"),
        isNull(planEntry.deletedAt),
        sql`${planEntry.planDate} >= today_ist()`,
      ),
    )
    .orderBy(asc(planEntry.planDate))
    .limit(1);
  return row?.planDate ?? null;
}
