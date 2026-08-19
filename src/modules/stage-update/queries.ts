import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { designProcess, poItem, stage } from "@/db/schema";
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
    })
    .from(vPoItemStatus)
    .innerJoin(poItem, eq(poItem.id, vPoItemStatus.poItemId))
    .leftJoin(routes, eq(routes.designId, poItem.designId))
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
