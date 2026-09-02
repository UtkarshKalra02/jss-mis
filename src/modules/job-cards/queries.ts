import { and, asc, count, desc, eq, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import {
  client,
  design,
  designProcess,
  jobCard,
  poItem,
  pressRun,
  purchaseOrder,
  stage,
} from "@/db/schema";
import { vPoItemStatus } from "@/db/views";

/**
 * Reads for job cards.
 *
 * A job card is a DOCUMENT, and almost everything on it belongs to something
 * else — the item, its purchase order, its client, its design. So the queries
 * here are wide joins rather than a row plus five lookups: the card is only
 * ever read in order to print it or to look at what was printed, and both need
 * the whole thing at once.
 */

type Runner = typeof db | Tx;

const LIVE = isNull(jobCard.deletedAt);

export type JobCardDetail = {
  id: string;
  jcNo: string;
  plannedQty: number | null;
  plannedDate: string | null;
  status: string;
  holdReason: string | null;
  notes: string | null;

  paperSupplyBy: string | null;
  plateSupplyBy: string | null;
  plateJobId: string | null;
  machineDetail: string | null;

  finalQty: number | null;
  wastageQty: number | null;
  executionRemarks: string | null;

  createdAt: Date;

  pressRunId: string | null;
  runNo: string | null;
  runDate: string | null;
  runMachine: string | null;

  poItemId: string;
  itemCode: string;
  itemName: string;
  orderedQty: number;
  committedDate: string | null;
  itemStatus: string;

  purchaseOrderId: string;
  poInternalNo: string;
  clientPoNo: string | null;
  poDate: string;

  clientId: string;
  clientCode: string;
  clientName: string;

  designId: string | null;
  designCode: string | null;
  designJobName: string | null;
  designJobSize: string | null;
  designGsm: string | null;
  designPaperType: string | null;
  designPrintType: string | null;
  designNoOfColours: string | null;
};

/**
 * One job card, with everything printed on it.
 *
 * The design columns come back even when `design_id` is null — spec 6.3 makes
 * the design optional on a PO item, and a card for an item with no design is
 * a card whose paper detail is printed blank for hand entry (J5), not an
 * error.
 */
export async function getJobCard(
  id: string,
  runner: Runner = db,
): Promise<JobCardDetail | null> {
  const [row] = await runner
    .select({
      id: jobCard.id,
      jcNo: jobCard.jcNo,
      plannedQty: jobCard.plannedQty,
      plannedDate: jobCard.plannedDate,
      status: jobCard.status,
      holdReason: jobCard.holdReason,
      notes: jobCard.notes,

      paperSupplyBy: jobCard.paperSupplyBy,
      plateSupplyBy: jobCard.plateSupplyBy,
      plateJobId: jobCard.plateJobId,
      machineDetail: jobCard.machineDetail,

      finalQty: jobCard.finalQty,
      wastageQty: jobCard.wastageQty,
      executionRemarks: jobCard.executionRemarks,

      createdAt: jobCard.createdAt,

      pressRunId: jobCard.pressRunId,
      runNo: pressRun.runNo,
      runDate: pressRun.runDate,
      runMachine: pressRun.machine,

      poItemId: poItem.id,
      itemCode: poItem.itemCode,
      itemName: poItem.itemName,
      orderedQty: poItem.orderedQty,
      committedDate: poItem.committedDate,
      itemStatus: poItem.status,

      purchaseOrderId: purchaseOrder.id,
      poInternalNo: purchaseOrder.internalNo,
      clientPoNo: purchaseOrder.poNo,
      poDate: purchaseOrder.poDate,

      clientId: client.id,
      clientCode: client.code,
      clientName: client.name,

      designId: design.id,
      designCode: design.designCode,
      designJobName: design.jobName,
      designJobSize: design.jobSize,
      designGsm: design.gsm,
      designPaperType: design.paperType,
      designPrintType: design.printType,
      designNoOfColours: design.noOfColours,
    })
    .from(jobCard)
    .innerJoin(poItem, eq(poItem.id, jobCard.poItemId))
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, poItem.purchaseOrderId))
    .innerJoin(client, eq(client.id, purchaseOrder.clientId))
    .leftJoin(design, eq(design.id, poItem.designId))
    .leftJoin(pressRun, eq(pressRun.id, jobCard.pressRunId))
    .where(and(eq(jobCard.id, id), LIVE))
    .limit(1);

  return row ?? null;
}

/** The raw row, for actions that check before writing. */
export async function getJobCardRecord(id: string, runner: Runner = db) {
  const [row] = await runner
    .select()
    .from(jobCard)
    .where(and(eq(jobCard.id, id), LIVE))
    .limit(1);

  return row ?? null;
}

export type ProcessLine = {
  code: string;
  name: string;
  /** True when this design's route includes the stage. */
  onRoute: boolean;
};

/**
 * The fabrication checklist for the printed card (J5).
 *
 * EVERY process stage is returned, not just the ones on the design's route,
 * with `onRoute` saying which apply. A printed form lists all its options —
 * showing only the route would leave an operator with nowhere to tick a
 * process added on the day, and the paper card being replaced has every line
 * printed whether or not the job needs it.
 *
 * `is_process` is what separates floor work from order lifecycle (F18), so
 * ENQUIRY, PO_RECEIVED, READY and DISPATCHED are correctly absent: none of
 * them is a thing that happens to paper.
 */
export async function processChecklistFor(
  designId: string | null,
  runner: Runner = db,
): Promise<ProcessLine[]> {
  const stages = await runner
    .select({ code: stage.code, name: stage.name })
    .from(stage)
    .where(and(isNull(stage.deletedAt), eq(stage.isActive, true), eq(stage.isProcess, true)))
    .orderBy(asc(stage.sequence));

  if (!designId) return stages.map((s) => ({ ...s, onRoute: false }));

  const route = await runner
    .select({ stageCode: designProcess.stageCode })
    .from(designProcess)
    .where(and(eq(designProcess.designId, designId), isNull(designProcess.deletedAt)));

  const onRoute = new Set(route.map((r) => r.stageCode));
  return stages.map((s) => ({ ...s, onRoute: onRoute.has(s.code) }));
}

/**
 * How many live cards this item already has.
 *
 * Drives the second-card warning (J3). Not a constraint: spec section 3 says a
 * PO item may have several job cards for repeat and split runs, so this counts
 * in order to ask a question, never to refuse.
 */
export async function liveCardCountFor(
  poItemId: string,
  runner: Runner = db,
  excludeId?: string,
): Promise<number> {
  const [row] = await runner
    .select({ n: count() })
    .from(jobCard)
    .where(
      and(
        eq(jobCard.poItemId, poItemId),
        LIVE,
        excludeId ? ne(jobCard.id, excludeId) : undefined,
      ),
    );

  return row?.n ?? 0;
}

export type ReleasableItem = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  pendingQty: number;
  committedDate: string | null;
  currentStageName: string | null;
  cardCount: number;
};

/**
 * The one item a release form is being opened for.
 *
 * Read through `v_po_item_status` rather than `po_item`, so `pending_qty` has
 * exactly one definition (non-negotiable 2) and the default planned quantity
 * on the form is the same number the Item Tracker shows.
 */
export async function releasableItem(
  poItemId: string,
  runner: Runner = db,
): Promise<ReleasableItem | null> {
  const [row] = await runner
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      pendingQty: vPoItemStatus.pendingQty,
      committedDate: vPoItemStatus.committedDate,
      currentStageName: vPoItemStatus.currentStageName,
    })
    .from(vPoItemStatus)
    .where(eq(vPoItemStatus.poItemId, poItemId))
    .limit(1);

  if (!row) return null;

  return { ...row, cardCount: await liveCardCountFor(poItemId, runner) };
}

export type ItemJobCardRow = {
  id: string;
  jcNo: string;
  plannedQty: number | null;
  plannedDate: string | null;
  status: string;
  finalQty: number | null;
  wastageQty: number | null;
  machineDetail: string | null;
  pressRunId: string | null;
};

/**
 * The cards on one item, for the Item Tracker panel.
 *
 * Supersedes `getItemJobCards` in the items module, which returned four
 * columns for a table that never rendered because nothing created a card. The
 * extra columns are the ones somebody opening the tracker actually wants:
 * what ran, on what, and what came off.
 */
export async function jobCardsForItem(
  poItemId: string,
  runner: Runner = db,
): Promise<ItemJobCardRow[]> {
  return runner
    .select({
      id: jobCard.id,
      jcNo: jobCard.jcNo,
      plannedQty: jobCard.plannedQty,
      plannedDate: jobCard.plannedDate,
      status: jobCard.status,
      finalQty: jobCard.finalQty,
      wastageQty: jobCard.wastageQty,
      machineDetail: jobCard.machineDetail,
      pressRunId: jobCard.pressRunId,
    })
    .from(jobCard)
    .where(and(eq(jobCard.poItemId, poItemId), LIVE))
    .orderBy(desc(jobCard.plannedDate), desc(jobCard.createdAt));
}
