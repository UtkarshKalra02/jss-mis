import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import {
  client,
  design,
  jobCard,
  machine,
  poItem,
  pressRun,
  purchaseOrder,
} from "@/db/schema";
import { vPoItemStatus } from "@/db/views";
import type { PaperBundle } from "./paper";

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
  machineId: string | null;
  machineName: string | null;
  machineSheetSize: string | null;

  checklistPaper: boolean;
  checklistPlates: boolean;
  checklistColour: boolean;

  paperSize: string | null;
  paperGsm: string | null;
  paperFinish: string | null;
  paperQty: number | null;
  paperBundle: PaperBundle | null;
  paperParts: number | null;
  paperRemarks: string | null;

  execNoOfColours: string | null;
  execPantone: string | null;

  fabricationRemarks: string | null;

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
      machineId: jobCard.machineId,
      machineName: machine.name,
      machineSheetSize: machine.sheetSize,

      checklistPaper: jobCard.checklistPaper,
      checklistPlates: jobCard.checklistPlates,
      checklistColour: jobCard.checklistColour,

      paperSize: jobCard.paperSize,
      paperGsm: jobCard.paperGsm,
      paperFinish: jobCard.paperFinish,
      paperQty: jobCard.paperQty,
      paperBundle: jobCard.paperBundle,
      paperParts: jobCard.paperParts,
      paperRemarks: jobCard.paperRemarks,

      execNoOfColours: jobCard.execNoOfColours,
      execPantone: jobCard.execPantone,

      fabricationRemarks: jobCard.fabricationRemarks,

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
    .leftJoin(machine, eq(machine.id, jobCard.machineId))
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

/*
 * The stage-based fabrication checklist used to live here, and is gone.
 *
 * It printed every `is_process` stage with an empty box for the floor to tick,
 * which was right while the system held no fabrication detail. It cannot
 * express the card's real vocabulary: three laminations under one LAMINATION
 * stage, two UV lines under one UV stage, and Varnish and Embossing under no
 * stage at all. `printedChecklist` in src/modules/fabrication/queries.ts is
 * the replacement, and it carries each line's ANSWER as well as its tick (J8).
 */


/**
 * How many live cards this item already has.
 *
 * Drives the second-card warning (J3). Not a constraint: spec section 3 says a
 * PO item may have several job cards for repeat and split runs, so this counts
 * in order to ask a question, never to refuse.
 *
 * CANCELLED CARDS ARE NOT COUNTED (J12). A cancelled card is one that was
 * raised and then withdrawn — it did not run, and warning "this item already
 * has a card" on the strength of one somebody deliberately cancelled would
 * make the warning noise, which is how a warning stops being read.
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
        ne(jobCard.status, "Cancelled"),
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
  machineName: string | null;
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
      machineName: machine.name,
      pressRunId: jobCard.pressRunId,
    })
    .from(jobCard)
    .leftJoin(machine, eq(machine.id, jobCard.machineId))
    .where(and(eq(jobCard.poItemId, poItemId), LIVE))
    .orderBy(desc(jobCard.plannedDate), desc(jobCard.createdAt));
}

/** The presses a job card may be ticked against (J10). */
export async function machineOptions(runner: Runner = db) {
  return runner
    .select({
      id: machine.id,
      name: machine.name,
      sheetSize: machine.sheetSize,
    })
    .from(machine)
    .where(and(isNull(machine.deletedAt), eq(machine.isActive, true)))
    .orderBy(asc(machine.sequence), asc(machine.name));
}

export type JobCardListRow = {
  id: string;
  jcNo: string;
  plannedDate: string | null;
  status: string;
  plannedQty: number | null;
  finalQty: number | null;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  machineName: string | null;
  pressRunId: string | null;
};

/**
 * The job card list — every card, newest planned first.
 *
 * One search box across card number, item, client and machine, on the same
 * reasoning as the Item Tracker (F24): somebody asked to reprint "the
 * Fertilina card" has a fragment, not a field name.
 */
export async function searchJobCards(
  query: string,
  opts: { openOnly?: boolean; limit?: number } = {},
): Promise<JobCardListRow[]> {
  const term = query.trim();
  const like = `%${term}%`;

  const matches = term
    ? or(
        ilike(jobCard.jcNo, like),
        ilike(poItem.itemCode, like),
        ilike(poItem.itemName, like),
        ilike(client.code, like),
        ilike(client.name, like),
        ilike(machine.name, like),
      )
    : undefined;

  /*
   * "Open" here means a card the floor could still be working from. A
   * completed or cancelled card is history, and burying this week's six cards
   * under two years of them is the failure the Item Tracker's open-only
   * default exists to prevent (F22).
   */
  const openOnly = opts.openOnly
    ? inArray(jobCard.status, ["Planned", "In Process", "On Hold"])
    : undefined;

  return db
    .select({
      id: jobCard.id,
      jcNo: jobCard.jcNo,
      plannedDate: jobCard.plannedDate,
      status: jobCard.status,
      plannedQty: jobCard.plannedQty,
      finalQty: jobCard.finalQty,
      itemCode: poItem.itemCode,
      itemName: poItem.itemName,
      clientCode: client.code,
      clientName: client.name,
      machineName: machine.name,
      pressRunId: jobCard.pressRunId,
    })
    .from(jobCard)
    .innerJoin(poItem, eq(poItem.id, jobCard.poItemId))
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, poItem.purchaseOrderId))
    .innerJoin(client, eq(client.id, purchaseOrder.clientId))
    .leftJoin(machine, eq(machine.id, jobCard.machineId))
    .where(and(LIVE, matches, openOnly))
    .orderBy(sql`${jobCard.plannedDate} desc nulls last`, desc(jobCard.createdAt))
    .limit(opts.limit ?? 200);
}

export type ReleasableRow = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  poInternalNo: string;
  pendingQty: number;
  committedDate: string | null;
  /** From the view, so it is measured against today_ist() and not a JS clock. */
  daysToCommitted: number | null;
  currentStageName: string | null;
  isOverdue: boolean;
  cards: number;
};

/**
 * Items a job card could be raised against — the picker on /job-cards/new.
 *
 * Every OPEN item with quantity still owed, most urgent first, in the same
 * order the Item Tracker and Stage Update use. Items that already have a card
 * are included and say so: a second card is legitimate for a split or repeat
 * run (J3), so this counts in order to inform rather than to filter.
 */
export async function releasableItems(query = "", limit = 200): Promise<ReleasableRow[]> {
  const term = query.trim();
  const like = `%${term}%`;

  const matches = term
    ? or(
        ilike(vPoItemStatus.itemCode, like),
        ilike(vPoItemStatus.itemName, like),
        ilike(vPoItemStatus.clientCode, like),
        ilike(vPoItemStatus.clientName, like),
        ilike(vPoItemStatus.poInternalNo, like),
      )
    : undefined;

  return db
    .select({
      poItemId: vPoItemStatus.poItemId,
      itemCode: vPoItemStatus.itemCode,
      itemName: vPoItemStatus.itemName,
      clientCode: vPoItemStatus.clientCode,
      clientName: vPoItemStatus.clientName,
      poInternalNo: vPoItemStatus.poInternalNo,
      pendingQty: vPoItemStatus.pendingQty,
      committedDate: vPoItemStatus.committedDate,
      daysToCommitted: vPoItemStatus.daysToCommitted,
      currentStageName: vPoItemStatus.currentStageName,
      isOverdue: vPoItemStatus.isOverdue,
      /*
       * Live cards already on this item. Written with an explicit table name
       * rather than drizzle's `${column}` interpolation — in a correlated
       * subquery that renders bare names and silently compares a column to
       * itself, which is the bug H7 documents and that shipped twice.
       */
      cards: sql<number>`(
        select count(*)::int from job_card jc
        where jc.po_item_id = v_po_item_status.po_item_id
          and jc.deleted_at is null
      )`,
    })
    .from(vPoItemStatus)
    .where(and(eq(vPoItemStatus.status, "Open"), gt(vPoItemStatus.pendingQty, 0), matches))
    .orderBy(
      desc(vPoItemStatus.isOverdue),
      sql`${vPoItemStatus.committedDate} asc nulls last`,
      asc(vPoItemStatus.itemCode),
    )
    .limit(limit);
}
