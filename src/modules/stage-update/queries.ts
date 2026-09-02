import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { designProcess, jobCard, poItem, pressRun, stage } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

import type { StageOption } from "./precedence";

export type StageUpdateRow = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  poInternalNo: string;
  orderedQty: number;
  pendingQty: number;
  jobType: "New" | "Repeat";
  priority: string;
  currentStage: string | null;
  currentStageName: string | null;
  currentStageColour: string | null;
  currentStageSequence: number | null;
  currentStageSince: Date | null;
  committedDate: string | null;
  daysToCommitted: number | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  /** Stage codes from the item's design route. Empty when it has none (F4). */
  routeCodes: string[];

  /**
   * The press run this item's job card was printed in, when it was ganged.
   *
   * Null for the overwhelming majority — ganging is three to eight jobs a
   * month (H1) — and those rows render exactly as they always have. It is here
   * so the screen can COLLAPSE a shared plate into one row (H8); the data
   * itself is untouched, per client and per job card as H1 built it.
   */
  pressRunId: string | null;
  runNo: string | null;
  runDate: string | null;
  runMachine: string | null;
};

/**
 * Every open item with work still owed — spec 6.7's grid.
 *
 * Ordered the same way the Item Tracker orders: overdue first, then the
 * nearest commitment. Two screens that disagree about what is urgent are two
 * screens somebody has to reconcile in their head.
 *
 * The design route comes back as an aggregated array per item rather than a
 * join, so one item with a four-stage route is still one row.
 */
export async function listItemsToUpdate(): Promise<StageUpdateRow[]> {
  const routes = db
    .select({
      designId: designProcess.designId,
      codes: sql<string[]>`array_agg(${designProcess.stageCode})`.as("codes"),
    })
    .from(designProcess)
    .where(isNull(designProcess.deletedAt))
    .groupBy(designProcess.designId)
    .as("routes");

  /*
   * The press run for each item, at most one row per item.
   *
   * An item may have several job cards (spec section 3 — split and repeat
   * runs), so this takes the most recently planned card that is actually on a
   * run. DISTINCT ON is what keeps one item to one row; a plain join would
   * duplicate an item across two plates and put it on the screen twice.
   */
  const gang = db
    .selectDistinctOn([jobCard.poItemId], {
      poItemId: jobCard.poItemId,
      pressRunId: pressRun.id,
      runNo: pressRun.runNo,
      runDate: pressRun.runDate,
      runMachine: pressRun.machine,
    })
    .from(jobCard)
    .innerJoin(pressRun, eq(pressRun.id, jobCard.pressRunId))
    .where(and(isNull(jobCard.deletedAt), isNull(pressRun.deletedAt)))
    .orderBy(
      jobCard.poItemId,
      sql`${jobCard.plannedDate} desc nulls last`,
      desc(jobCard.createdAt),
    )
    .as("gang");

  return db
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      poInternalNo: vPoItemStatus.poInternalNo,
      orderedQty: vPoItemStatus.orderedQty,
      pendingQty: vPoItemStatus.pendingQty,
      jobType: vPoItemStatus.jobType,
      priority: vPoItemStatus.priority,
      currentStage: vPoItemStatus.currentStage,
      currentStageName: vPoItemStatus.currentStageName,
      currentStageColour: vPoItemStatus.currentStageColour,
      currentStageSequence: vPoItemStatus.currentStageSequence,
      currentStageSince: vPoItemStatus.currentStageSince,
      committedDate: vPoItemStatus.committedDate,
      daysToCommitted: vPoItemStatus.daysToCommitted,
      isOverdue: vPoItemStatus.isOverdue,
      isAtRisk: vPoItemStatus.isAtRisk,
      routeCodes: sql<string[]>`coalesce(${routes.codes}, '{}')`,
      pressRunId: gang.pressRunId,
      runNo: gang.runNo,
      runDate: gang.runDate,
      runMachine: gang.runMachine,
    })
    .from(vPoItemStatus)
    .innerJoin(poItem, eq(poItem.id, vPoItemStatus.poItemId))
    .leftJoin(routes, eq(routes.designId, poItem.designId))
    .leftJoin(gang, eq(gang.poItemId, vPoItemStatus.poItemId))
    .where(and(eq(vPoItemStatus.status, "Open"), gt(vPoItemStatus.pendingQty, 0)))
    .orderBy(
      desc(vPoItemStatus.isOverdue),
      sql`${vPoItemStatus.committedDate} asc nulls last`,
      asc(vPoItemStatus.itemCode),
    );
}

/**
 * Every active stage, in sequence order.
 *
 * NOT filtered by is_process (F18). That flag decides what a DESIGN's route may
 * contain; this screen has to offer everything, because a job has to be moved
 * to READY and to DISPATCHED and neither is a manufacturing step.
 */
export async function listAllStages(): Promise<StageOption[]> {
  return db
    .select({
      code: stage.code,
      name: stage.name,
      colour: stage.colour,
      sequence: stage.sequence,
      isOptional: stage.isOptional,
      appliesTo: stage.appliesTo,
    })
    .from(stage)
    .where(and(isNull(stage.deletedAt), eq(stage.isActive, true)))
    .orderBy(asc(stage.sequence));
}

/**
 * How many live job cards each of these runs holds, in total.
 *
 * Needed because Stage Update only ever shows OPEN work: a plate that carried
 * three jobs shows two rows once one of them has been delivered, and a header
 * reading "3 jobs" against two visible rows is a worse lie than no number at
 * all. The screen says "2 of 3 jobs shown" instead.
 *
 * Written with an explicit table name rather than drizzle's `${column}`
 * interpolation. In a single-table query drizzle renders column references
 * bare, so a correlated subquery silently compares a column to itself and
 * every count comes back zero with no error anywhere — the bug H7 documents
 * and that shipped twice before it was found.
 */
export async function runCardCounts(runIds: readonly string[]): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();

  const rows = await db
    .select({
      pressRunId: jobCard.pressRunId,
      cards: sql<number>`count(*)::int`,
    })
    .from(jobCard)
    .where(and(inArray(jobCard.pressRunId, [...runIds]), isNull(jobCard.deletedAt)))
    .groupBy(jobCard.pressRunId);

  return new Map(rows.filter((r) => r.pressRunId !== null).map((r) => [r.pressRunId!, r.cards]));
}
