import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import { jobCard, jobCardItem, machine, pressRun } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

/**
 * Reads for the job planning board — spec 6.6, decision L1.
 *
 * THE BOARD PLANS JOB CARDS, NOT ITEMS. Spec 6.6 was written when "assign
 * item" was going to mint the card. Since then a card became a document a
 * person releases with paper, plate and machine detail (J1, J14) covering one
 * or more items (J25), and the 6pm meeting is not the place to fill in a dozen
 * fields twenty times. So a row here is a card, and "assign" writes one
 * column: `planned_date`.
 *
 * ONE ROW PER CARD, ONE QUERY. A card's urgency is its most urgent covered
 * item — the earliest committed date, overdue if any is — and its name is its
 * first item's, with the rest counted. Both come from `v_po_item_status`, so
 * the board's red and amber are the same red and amber the Item Tracker shows
 * (non-negotiables 1 and 2: stage and pending quantity are read from the view,
 * never reproduced here).
 */

type Runner = typeof db | Tx;

export type PlanningRow = {
  jobCardId: string;
  jcNo: string;
  status: string;
  plannedDate: string | null;
  machineName: string | null;

  /** The card's first item, for the row's name. The rest are counted. */
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  poInternalNo: string;
  itemCount: number;
  clientCount: number;

  /** Pieces still owed across every item the card covers. */
  pendingQty: number;

  /** The most urgent covered item's commitment. */
  committedDate: string | null;
  daysToCommitted: number | null;
  isOverdue: boolean;
  isAtRisk: boolean;

  /**
   * The first item's stage, which is the station the board groups by (L2).
   * `stageCount` says when the card's items have diverged, so the row can say
   * "mixed" rather than let one item's stage stand for all of them.
   */
  currentStage: string | null;
  currentStageName: string | null;
  currentStageColour: string | null;
  currentStageSequence: number | null;
  stageCount: number;

  pressRunId: string | null;
  runNo: string | null;
  runDate: string | null;
  runMachine: string | null;
};

/** Cards the floor could still be working from — the same set /job-cards calls open. */
const OPEN_STATUSES = ["Planned", "In Process", "On Hold"] as const;

/**
 * The shared shape of both lists, so the two panels of the board cannot
 * disagree about what a card is. The caller supplies the WHERE and ORDER.
 */
function planningRows(runner: Runner) {
  /*
   * Everything the card's items add up to, one row per card.
   *
   * MIN over committed date and days-to-committed is "the most urgent";
   * bool_or over the flags is "any of them". Items already delivered are
   * excluded from the pending total and the open count, so a card whose last
   * item has shipped counts as having nothing left to plan.
   */
  const totals = runner
    .select({
      jobCardId: jobCardItem.jobCardId,
      itemCount: sql<number>`count(*)::int`.as("item_count"),
      clientCount: sql<number>`count(distinct ${vPoItemStatus.clientCode})::int`.as(
        "client_count",
      ),
      stageCount: sql<number>`count(distinct ${vPoItemStatus.currentStage})::int`.as(
        "stage_count",
      ),
      openItems: sql<number>`count(*) filter (
        where ${vPoItemStatus.status} = 'Open' and ${vPoItemStatus.pendingQty} > 0
      )::int`.as("open_items"),
      pendingQty: sql<number>`coalesce(sum(greatest(${vPoItemStatus.pendingQty}, 0)), 0)::int`.as(
        "pending_qty",
      ),
      committedDate: sql<string | null>`min(${vPoItemStatus.committedDate})`.as("committed_date"),
      daysToCommitted: sql<number | null>`min(${vPoItemStatus.daysToCommitted})`.as(
        "days_to_committed",
      ),
      isOverdue: sql<boolean>`bool_or(${vPoItemStatus.isOverdue})`.as("is_overdue"),
      isAtRisk: sql<boolean>`bool_or(${vPoItemStatus.isAtRisk})`.as("is_at_risk"),
    })
    .from(jobCardItem)
    .innerJoin(vPoItemStatus, eq(vPoItemStatus.poItemId, jobCardItem.poItemId))
    .where(isNull(jobCardItem.deletedAt))
    .groupBy(jobCardItem.jobCardId)
    .as("totals");

  /*
   * The card's FIRST item, by the order the items were added (J25) — the same
   * one the job card list and the card screen lead with, so a card is called
   * the same thing on every screen.
   */
  const first = runner
    .selectDistinctOn([jobCardItem.jobCardId], {
      jobCardId: jobCardItem.jobCardId,
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      poInternalNo: vPoItemStatus.poInternalNo,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,
      currentStageSequence: vPoItemStatus.currentStageSequence,
    })
    .from(jobCardItem)
    .innerJoin(vPoItemStatus, eq(vPoItemStatus.poItemId, jobCardItem.poItemId))
    .where(isNull(jobCardItem.deletedAt))
    .orderBy(jobCardItem.jobCardId, asc(jobCardItem.createdAt))
    .as("first");

  return {
    totals,
    first,
    query: runner
      .select({
        jobCardId: jobCard.id,
        jcNo: jobCard.jcNo,
        status: jobCard.status,
        plannedDate: jobCard.plannedDate,
        machineName: machine.name,

        poItemId: first.poItemId,
        itemCode: first.itemCode,
        itemName: first.itemName,
        clientCode: first.clientCode,
        clientName: first.clientName,
        poInternalNo: first.poInternalNo,
        itemCount: totals.itemCount,
        clientCount: totals.clientCount,

        pendingQty: totals.pendingQty,
        committedDate: totals.committedDate,
        daysToCommitted: totals.daysToCommitted,
        isOverdue: totals.isOverdue,
        isAtRisk: totals.isAtRisk,

        currentStage: first.currentStage,
        currentStageName: first.currentStageName,
        currentStageColour: first.currentStageColour,
        currentStageSequence: first.currentStageSequence,
        stageCount: totals.stageCount,

        pressRunId: jobCard.pressRunId,
        runNo: pressRun.runNo,
        runDate: pressRun.runDate,
        runMachine: pressRun.machine,
      })
      .from(jobCard)
      .innerJoin(totals, eq(totals.jobCardId, jobCard.id))
      .innerJoin(first, eq(first.jobCardId, jobCard.id))
      .leftJoin(machine, eq(machine.id, jobCard.machineId))
      .leftJoin(
        pressRun,
        and(eq(pressRun.id, jobCard.pressRunId), isNull(pressRun.deletedAt)),
      ),
  };
}

/**
 * The left panel: cards that need a day.
 *
 * Open cards with quantity still owed and EITHER no planned date OR a planned
 * date that has passed. The second half is what makes the board honest: a card
 * planned for yesterday and still open has slipped, and the meeting's first
 * question is what happened to it. It is shown with its old date rather than
 * quietly re-listed as new.
 *
 * Ordered the way every worklist in this system is — overdue first, then the
 * nearest commitment — so a plate carrying an overdue job inherits that
 * position when the board collapses it (H8).
 */
export async function cardsToPlan(runner: Runner = db): Promise<PlanningRow[]> {
  const { totals, query } = planningRows(runner);

  return query
    .where(
      and(
        isNull(jobCard.deletedAt),
        inArray(jobCard.status, [...OPEN_STATUSES]),
        sql`${totals.openItems} > 0`,
        or(isNull(jobCard.plannedDate), sql`${jobCard.plannedDate} < today_ist()`),
      ),
    )
    .orderBy(
      desc(totals.isOverdue),
      sql`${totals.committedDate} asc nulls last`,
      asc(jobCard.jcNo),
    );
}

/**
 * The right panel and the printed floor plan: what is planned for one day.
 *
 * Every live card dated that day except a cancelled one — a card planned for
 * a past day and since completed still belongs on that day's plan, because
 * the plan is a record of what was scheduled, not only of what is left. Cards
 * whose items have all shipped are included for the same reason; the row says
 * so through its status.
 *
 * Ordered by station — the first item's stage sequence — so the grouping the
 * screen and the sheet apply is a walk down a sorted list, then by urgency
 * within a station.
 */
export async function dayPlan(date: string, runner: Runner = db): Promise<PlanningRow[]> {
  const { totals, first, query } = planningRows(runner);

  return query
    .where(
      and(
        isNull(jobCard.deletedAt),
        sql`${jobCard.status} <> 'Cancelled'`,
        eq(jobCard.plannedDate, date),
      ),
    )
    .orderBy(
      sql`${first.currentStageSequence} asc nulls last`,
      desc(totals.isOverdue),
      sql`${totals.committedDate} asc nulls last`,
      asc(jobCard.jcNo),
    );
}

/**
 * How many days around the chosen one carry a plan — the strip under the day
 * picker, so the meeting can see at a glance what the rest of the week holds
 * without paging through it.
 */
export async function plannedCountsBetween(
  from: string,
  to: string,
  runner: Runner = db,
): Promise<Map<string, number>> {
  const rows = await runner
    .select({
      plannedDate: jobCard.plannedDate,
      cards: sql<number>`count(*)::int`,
    })
    .from(jobCard)
    .where(
      and(
        isNull(jobCard.deletedAt),
        sql`${jobCard.status} <> 'Cancelled'`,
        sql`${jobCard.plannedDate} between ${from} and ${to}`,
      ),
    )
    .groupBy(jobCard.plannedDate);

  return new Map(rows.filter((r) => r.plannedDate !== null).map((r) => [r.plannedDate!, r.cards]));
}

/**
 * Open items with quantity owed and NO live card at all (L1).
 *
 * The board cannot plan these — there is nothing to date — so it counts them
 * and points at the release screen. Cancelled cards do not count as cover, on
 * J12's reasoning: a card raised and withdrawn did not run.
 *
 * Written with an explicit table name rather than drizzle's `${column}`
 * interpolation, for the reason H7 documents.
 */
export async function unreleasedItemCount(runner: Runner = db): Promise<number> {
  const [row] = await runner
    .select({ n: sql<number>`count(*)::int` })
    .from(vPoItemStatus)
    .where(
      and(
        eq(vPoItemStatus.status, "Open"),
        sql`${vPoItemStatus.pendingQty} > 0`,
        sql`not exists (
          select 1
            from job_card_item jci
            join job_card jc on jc.id = jci.job_card_id
           where jci.po_item_id = v_po_item_status.po_item_id
             and jci.deleted_at is null
             and jc.deleted_at is null
             and jc.status <> 'Cancelled'
        )`,
      ),
    );

  return row?.n ?? 0;
}

/**
 * How many live cards each of these runs holds, in total — the "2 of 3 jobs
 * shown" line on a collapsed plate (H8), reused unchanged from Stage Update's
 * reasoning: a header claiming three jobs above two rows is a worse lie than
 * no number.
 */
export async function runCardTotals(
  runIds: readonly string[],
  runner: Runner = db,
): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();

  const rows = await runner
    .select({ pressRunId: jobCard.pressRunId, cards: sql<number>`count(*)::int` })
    .from(jobCard)
    .where(and(inArray(jobCard.pressRunId, [...runIds]), isNull(jobCard.deletedAt)))
    .groupBy(jobCard.pressRunId);

  return new Map(rows.filter((r) => r.pressRunId !== null).map((r) => [r.pressRunId!, r.cards]));
}

/**
 * The live members of each run among these cards, for the whole-plate rule
 * (L4): a run's date moves only when every card on it is being planned
 * together. Returns run → member card ids, live cards only.
 */
export async function runMembersOf(
  jobCardIds: readonly string[],
  runner: Runner = db,
): Promise<Map<string, string[]>> {
  if (jobCardIds.length === 0) return new Map();

  const runs = runner
    .selectDistinct({ pressRunId: jobCard.pressRunId })
    .from(jobCard)
    .where(and(inArray(jobCard.id, [...jobCardIds]), isNull(jobCard.deletedAt)))
    .as("runs");

  const rows = await runner
    .select({ pressRunId: jobCard.pressRunId, jobCardId: jobCard.id })
    .from(jobCard)
    .innerJoin(runs, eq(runs.pressRunId, jobCard.pressRunId))
    .where(and(isNull(jobCard.deletedAt), sql`${jobCard.status} <> 'Cancelled'`));

  const members = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.pressRunId) continue;
    const list = members.get(row.pressRunId) ?? [];
    list.push(row.jobCardId);
    members.set(row.pressRunId, list);
  }
  return members;
}

/** The raw cards, for the action's checks before it writes. */
export async function jobCardsByIds(jobCardIds: readonly string[], runner: Runner = db) {
  if (jobCardIds.length === 0) return [];
  return runner
    .select({
      id: jobCard.id,
      jcNo: jobCard.jcNo,
      status: jobCard.status,
      plannedDate: jobCard.plannedDate,
      pressRunId: jobCard.pressRunId,
    })
    .from(jobCard)
    .where(and(inArray(jobCard.id, [...jobCardIds]), isNull(jobCard.deletedAt)));
}
