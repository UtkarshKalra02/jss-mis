import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import { client, design, jobCard, machine, poItem, pressRun, purchaseOrder } from "@/db/schema";

/**
 * Reads for press runs (ganging).
 *
 * The thing worth knowing here is that a press run is deliberately shallow:
 * it holds a number, a date, a machine note, and the job cards that point at
 * it. There is no cost split, no schedule and no shared stage — all three are
 * out of scope by decision (H2), so nothing in this file computes them.
 */

type Runner = typeof db | Tx;

export type PressRunRow = {
  id: string;
  runNo: string;
  runDate: string;
  /** Free text from H1, kept readable for rows that predate machine_id. */
  machine: string | null;
  machineId: string | null;
  machineName: string | null;
  machineSheetSize: string | null;

  /** The sheet, shared by every job on the plate (J15). */
  paperSize: string | null;
  paperGsm: string | null;
  paperFinish: string | null;
  sheetsPerReam: number | null;
  paperRemarks: string | null;
  plateJobId: string | null;
  paperSupplyBy: string | null;
  plateSupplyBy: string | null;

  /** One set for the whole plate, blank on the printed sheet (J15). */
  finalQty: number | null;
  wastageQty: number | null;
  executionRemarks: string | null;

  notes: string | null;
};

export async function getPressRun(
  id: string,
  runner: Runner = db,
): Promise<PressRunRow | null> {
  const [row] = await runner
    .select({
      id: pressRun.id,
      runNo: pressRun.runNo,
      runDate: pressRun.runDate,
      machine: pressRun.machine,
      machineId: pressRun.machineId,
      machineName: machine.name,
      machineSheetSize: machine.sheetSize,

      paperSize: pressRun.paperSize,
      paperGsm: pressRun.paperGsm,
      paperFinish: pressRun.paperFinish,
      sheetsPerReam: pressRun.sheetsPerReam,
      paperRemarks: pressRun.paperRemarks,
      plateJobId: pressRun.plateJobId,
      paperSupplyBy: pressRun.paperSupplyBy,
      plateSupplyBy: pressRun.plateSupplyBy,

      finalQty: pressRun.finalQty,
      wastageQty: pressRun.wastageQty,
      executionRemarks: pressRun.executionRemarks,

      notes: pressRun.notes,
    })
    .from(pressRun)
    .leftJoin(machine, eq(machine.id, pressRun.machineId))
    .where(and(eq(pressRun.id, id), isNull(pressRun.deletedAt)))
    .limit(1);

  return row ?? null;
}

export type RunMember = {
  jobCardId: string;
  jcNo: string;
  plannedQty: number | null;
  plannedDate: string | null;
  status: string;
  poItemId: string;
  itemCode: string;
  itemName: string;
  orderedQty: number;
  /** Each member keeps its OWN design, and therefore its own finishing (H2). */
  designId: string | null;
  designCode: string | null;
  clientId: string;
  clientCode: string;
  clientName: string;
};

/**
 * The job cards printed in one run, with the client each belongs to.
 *
 * SEVERAL CLIENTS IN THIS LIST IS NORMAL and the screen must not warn about it
 * (H3). That is the difference between this join and the cross-client checks on
 * dispatch and invoice: there, a second client means somebody picked the wrong
 * row; here it means the plate was filled properly.
 *
 * Ordered by client then item so a gang reads as "who is on this plate", which
 * is the question somebody standing at the press actually has.
 */
export async function getRunMembers(id: string, runner: Runner = db): Promise<RunMember[]> {
  return runner
    .select({
      jobCardId: jobCard.id,
      jcNo: jobCard.jcNo,
      plannedQty: jobCard.plannedQty,
      plannedDate: jobCard.plannedDate,
      status: jobCard.status,
      poItemId: poItem.id,
      itemCode: poItem.itemCode,
      itemName: poItem.itemName,
      orderedQty: poItem.orderedQty,
      designId: poItem.designId,
      designCode: design.designCode,
      clientId: client.id,
      clientCode: client.code,
      clientName: client.name,
    })
    .from(jobCard)
    .innerJoin(poItem, eq(poItem.id, jobCard.poItemId))
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, poItem.purchaseOrderId))
    .innerJoin(client, eq(client.id, purchaseOrder.clientId))
    .leftJoin(design, eq(design.id, poItem.designId))
    .where(and(eq(jobCard.pressRunId, id), isNull(jobCard.deletedAt)))
    .orderBy(asc(client.name), asc(poItem.itemCode));
}

/** How many days back the add-to-run picker looks. See H5. */
const RECENT_DAYS = 30;

export type RunOption = {
  id: string;
  runNo: string;
  runDate: string;
  machine: string | null;
  cardCount: number;
};

/**
 * Runs to offer when adding a job card to one.
 *
 * "RECENT", not "open" — press_run has no status column and this deliberately
 * does not invent one (H5). A press run is a thing that happened on a date, so
 * the useful question when ganging is "which plate am I building for the next
 * day or two", and recency answers it without a lifecycle nobody asked to
 * maintain. Anything older is still reachable by its number from the item it
 * was printed with.
 *
 * The cut-off goes through today_ist() rather than a JavaScript date, on the
 * same reasoning as everything else that compares to a day boundary (C10).
 */
export async function recentRuns(runner: Runner = db): Promise<RunOption[]> {
  return runner
    .select({
      id: pressRun.id,
      runNo: pressRun.runNo,
      runDate: pressRun.runDate,
      machine: pressRun.machine,
      /*
       * Written with EXPLICIT table names rather than drizzle's `${column}`
       * interpolation, which is a trap in a correlated subquery.
       *
       * Drizzle only qualifies a column reference when the surrounding query
       * has more than one table in scope. This query selects from press_run
       * alone, so `${jobCard.pressRunId}` and `${pressRun.id}` both render
       * bare — `where "press_run_id" = "id"` — and inside `from job_card` they
       * BOTH resolve to job_card. The subquery then asks whether a job card's
       * press_run_id equals its own id, which is never true, and every count
       * comes back 0 with no error anywhere.
       */
      cardCount: sql<number>`(
        select count(*)::int from job_card jc
        where jc.press_run_id = press_run.id
          and jc.deleted_at is null
      )`,
    })
    .from(pressRun)
    .where(
      and(
        isNull(pressRun.deletedAt),
        gte(pressRun.runDate, sql`today_ist() - ${RECENT_DAYS}::integer`),
      ),
    )
    .orderBy(desc(pressRun.runDate), desc(pressRun.createdAt));
}

/** The job card row itself, for actions that need to check before writing. */
export async function getJobCard(id: string, runner: Runner = db) {
  const [row] = await runner
    .select()
    .from(jobCard)
    .where(and(eq(jobCard.id, id), isNull(jobCard.deletedAt)))
    .limit(1);

  return row ?? null;
}

export type GangInfo = {
  pressRunId: string;
  runNo: string;
  runDate: string;
  /** Job cards in the run OTHER than this one. Zero means it ganged alone. */
  others: number;
};

/**
 * The badge on the Item Tracker: "Ganged with 2 others".
 *
 * Counts SIBLINGS rather than members, because the sentence on the screen is
 * about the other jobs on the plate — "ganged with 2 others" reads correctly
 * where "3 job cards in this run" makes the reader do the subtraction.
 *
 * A run holding one card returns others = 0, which the screen renders as a
 * plain run link rather than as "ganged with 0 others". That state is real and
 * transient: somebody starts a run, adds the second job a minute later.
 */
export async function gangInfoFor(
  jobCardIds: readonly string[],
  runner: Runner = db,
): Promise<Map<string, GangInfo>> {
  if (jobCardIds.length === 0) return new Map();

  const rows = await runner
    .select({
      jobCardId: jobCard.id,
      pressRunId: pressRun.id,
      runNo: pressRun.runNo,
      runDate: pressRun.runDate,
      others: sql<number>`(
        select count(*)::int from ${jobCard} sibling
        where sibling.press_run_id = ${pressRun.id}
          and sibling.deleted_at is null
          and sibling.id <> ${jobCard.id}
      )`,
    })
    .from(jobCard)
    .innerJoin(pressRun, eq(pressRun.id, jobCard.pressRunId))
    .where(
      and(
        inArray(jobCard.id, [...jobCardIds]),
        isNull(jobCard.deletedAt),
        isNull(pressRun.deletedAt),
      ),
    );

  return new Map(
    rows.map((r) => [
      r.jobCardId,
      { pressRunId: r.pressRunId, runNo: r.runNo, runDate: r.runDate, others: r.others },
    ]),
  );
}
