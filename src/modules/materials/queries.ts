import { and, asc, desc, eq, gt, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import {
  appSetting,
  appUser,
  grn,
  jobCard,
  material,
  materialAdjustment,
  materialBatch,
  materialCategory,
  materialIssue,
  materialType,
} from "@/db/schema";
import { vMaterialBatchStock, vMaterialStock } from "@/db/views";

import type { MovementKind } from "./validation";

type Runner = typeof db | Tx;

/* -------------------------------------------------------------------------- */
/* Vocabularies                                                                */
/* -------------------------------------------------------------------------- */

export async function listCategories(runner: Runner = db) {
  return runner
    .select({
      id: materialCategory.id,
      code: materialCategory.code,
      name: materialCategory.name,
      isActive: materialCategory.isActive,
    })
    .from(materialCategory)
    .where(isNull(materialCategory.deletedAt))
    .orderBy(asc(materialCategory.sequence), asc(materialCategory.name));
}

export async function listTypes(runner: Runner = db) {
  return runner
    .select({
      id: materialType.id,
      code: materialType.code,
      name: materialType.name,
      isActive: materialType.isActive,
    })
    .from(materialType)
    .where(isNull(materialType.deletedAt))
    .orderBy(asc(materialType.sequence), asc(materialType.name));
}

export type CategoryOption = Awaited<ReturnType<typeof listCategories>>[number];
export type TypeOption = Awaited<ReturnType<typeof listTypes>>[number];

/* -------------------------------------------------------------------------- */
/* Stock                                                                       */
/* -------------------------------------------------------------------------- */

export type StockRow = typeof vMaterialStock.$inferSelect;

/**
 * The stock grid: every live material with closing stock and reorder flags,
 * from the view. Inactive materials are included and marked, not hidden — a
 * discontinued board with 200 sheets left is still 200 sheets.
 */
export async function listStock(
  opts: { categoryId?: string; query?: string } = {},
): Promise<StockRow[]> {
  const q = opts.query?.trim();
  const matches = q
    ? or(
        ilike(vMaterialStock.sku, `%${q}%`),
        ilike(vMaterialStock.name, `%${q}%`),
        ilike(vMaterialStock.typeName, `%${q}%`),
        ilike(vMaterialStock.size, `%${q}%`),
      )
    : undefined;
  return db
    .select()
    .from(vMaterialStock)
    .where(and(opts.categoryId ? eq(vMaterialStock.categoryId, opts.categoryId) : undefined, matches))
    .orderBy(
      desc(vMaterialStock.needsReorder),
      desc(vMaterialStock.dueForIssue),
      asc(vMaterialStock.categoryName),
      asc(vMaterialStock.typeName),
      asc(vMaterialStock.name),
    );
}

/**
 * The sheet's "Operations check — due for issue" (P2): Interval items whose
 * last issue is older than their interval. Most often it means the floor
 * used it and nobody typed it; sometimes it means the interval is wrong.
 */
export async function listDueForIssue(): Promise<StockRow[]> {
  return db
    .select()
    .from(vMaterialStock)
    .where(eq(vMaterialStock.dueForIssue, true))
    .orderBy(asc(vMaterialStock.daysToIssue));
}

/** The departments issues have gone to, most used first — the issue form's picklist. */
export async function listDepartments(): Promise<string[]> {
  const rows = await db
    .select({ department: materialIssue.department, n: sql<number>`count(*)::int` })
    .from(materialIssue)
    .where(and(isNull(materialIssue.deletedAt), sql`${materialIssue.department} is not null`))
    .groupBy(materialIssue.department)
    .orderBy(desc(sql`count(*)`))
    .limit(30);
  return rows.map((r) => r.department!).filter(Boolean);
}

export async function getStock(materialId: string): Promise<StockRow | null> {
  const [row] = await db
    .select()
    .from(vMaterialStock)
    .where(eq(vMaterialStock.materialId, materialId))
    .limit(1);
  return row ?? null;
}

/** The stored row, for the edit form. */
export async function getMaterial(id: string, runner: Runner = db) {
  const [row] = await runner
    .select()
    .from(material)
    .where(and(eq(material.id, id), isNull(material.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** SKUs under a prefix, live or removed — the allocator counts both (O1). */
export async function skusUnderPrefix(prefix: string, runner: Runner = db): Promise<string[]> {
  const rows = await runner
    .select({ sku: material.sku })
    .from(material)
    .where(sql`${material.sku} like ${prefix + "-%"}`);
  return rows.map((r) => r.sku);
}

/**
 * Every material as a picker option, with stock, for the GRN and issue forms.
 * Inactive ones are left out of NEW receipts and issues — the point of
 * retiring one is that it stops being selectable.
 */
export async function listMaterialOptions() {
  return db
    .select({
      id: vMaterialStock.materialId,
      sku: vMaterialStock.sku,
      name: vMaterialStock.name,
      categoryName: vMaterialStock.categoryName,
      typeName: vMaterialStock.typeName,
      typeId: vMaterialStock.typeId,
      size: vMaterialStock.size,
      gsm: vMaterialStock.gsm,
      finish: vMaterialStock.finish,
      unit: vMaterialStock.unit,
      closingStock: vMaterialStock.closingStock,
    })
    .from(vMaterialStock)
    .where(eq(vMaterialStock.isActive, true))
    .orderBy(asc(vMaterialStock.categoryName), asc(vMaterialStock.name));
}

export type MaterialOption = Awaited<ReturnType<typeof listMaterialOptions>>[number];

/* -------------------------------------------------------------------------- */
/* Batches and movements                                                       */
/* -------------------------------------------------------------------------- */

/** A material's batches, oldest first, with what each has left. */
export async function batchesForMaterial(materialId: string) {
  return db
    .select({
      batchId: vMaterialBatchStock.batchId,
      batchNo: vMaterialBatchStock.batchNo,
      grnId: vMaterialBatchStock.grnId,
      grnNo: grn.grnNo,
      vendor: grn.vendor,
      receivedDate: vMaterialBatchStock.receivedDate,
      qtyReceived: vMaterialBatchStock.qtyReceived,
      qtyIssued: vMaterialBatchStock.qtyIssued,
      qtyAdjusted: vMaterialBatchStock.qtyAdjusted,
      qtyRemaining: vMaterialBatchStock.qtyRemaining,
      jobRef: materialBatch.jobRef,
      remarks: materialBatch.remarks,
    })
    .from(vMaterialBatchStock)
    .innerJoin(materialBatch, eq(materialBatch.id, vMaterialBatchStock.batchId))
    .leftJoin(grn, eq(grn.id, vMaterialBatchStock.grnId))
    .where(eq(vMaterialBatchStock.materialId, materialId))
    .orderBy(asc(vMaterialBatchStock.receivedDate), asc(vMaterialBatchStock.batchNo));
}

export type BatchRow = Awaited<ReturnType<typeof batchesForMaterial>>[number];

/**
 * Batches that still have something in them, for the issue and adjustment
 * pickers — every material, filtered in the browser once one is chosen.
 * OLDEST FIRST, so the default choice is the FIFO one (O3).
 */
export async function listOpenBatches() {
  return db
    .select({
      batchId: vMaterialBatchStock.batchId,
      batchNo: vMaterialBatchStock.batchNo,
      materialId: vMaterialBatchStock.materialId,
      receivedDate: vMaterialBatchStock.receivedDate,
      qtyRemaining: vMaterialBatchStock.qtyRemaining,
      /** Paper bought for a job (P3): the issue form offers it to that job first. */
      jobRef: materialBatch.jobRef,
    })
    .from(vMaterialBatchStock)
    .innerJoin(materialBatch, eq(materialBatch.id, vMaterialBatchStock.batchId))
    .where(gt(vMaterialBatchStock.qtyRemaining, "0"))
    .orderBy(asc(vMaterialBatchStock.receivedDate), asc(vMaterialBatchStock.batchNo));
}

export type OpenBatch = Awaited<ReturnType<typeof listOpenBatches>>[number];

/** Every live batch, empty ones included — an adjustment may refill one. */
export async function listAllBatches(): Promise<OpenBatch[]> {
  return db
    .select({
      batchId: vMaterialBatchStock.batchId,
      batchNo: vMaterialBatchStock.batchNo,
      materialId: vMaterialBatchStock.materialId,
      receivedDate: vMaterialBatchStock.receivedDate,
      qtyRemaining: vMaterialBatchStock.qtyRemaining,
      jobRef: materialBatch.jobRef,
    })
    .from(vMaterialBatchStock)
    .innerJoin(materialBatch, eq(materialBatch.id, vMaterialBatchStock.batchId))
    .orderBy(desc(vMaterialBatchStock.receivedDate), asc(vMaterialBatchStock.batchNo));
}

export async function getBatch(batchId: string, runner: Runner = db) {
  const [row] = await runner
    .select({
      id: materialBatch.id,
      batchNo: materialBatch.batchNo,
      materialId: materialBatch.materialId,
      sku: material.sku,
      name: material.name,
      unit: material.unit,
      jobRef: materialBatch.jobRef,
    })
    .from(materialBatch)
    .innerJoin(material, eq(material.id, materialBatch.materialId))
    .where(and(eq(materialBatch.id, batchId), isNull(materialBatch.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** What one batch has left, from the view. Null when the batch is gone. */
export async function batchRemaining(batchId: string): Promise<number | null> {
  const [row] = await db
    .select({ qtyRemaining: vMaterialBatchStock.qtyRemaining })
    .from(vMaterialBatchStock)
    .where(eq(vMaterialBatchStock.batchId, batchId))
    .limit(1);
  return row ? Number(row.qtyRemaining) : null;
}

export type Movement = {
  kind: "Issue" | "Adjustment";
  id: string;
  no: string;
  on: string;
  batchNo: string;
  qty: string;
  detail: string | null;
  jobCardId: string | null;
  jcNo: string | null;
  jobRef: string | null;
  remarks: string | null;
  enteredBy: string | null;
};

/** Issues and adjustments on one material, newest first. */
export async function movementsForMaterial(materialId: string): Promise<Movement[]> {
  const issues = await db
    .select({
      id: materialIssue.id,
      no: materialIssue.issueNo,
      on: materialIssue.issuedOn,
      batchNo: materialBatch.batchNo,
      qty: materialIssue.qty,
      detail: materialIssue.department,
      jobCardId: materialIssue.jobCardId,
      jcNo: jobCard.jcNo,
      jobRef: materialIssue.jobRef,
      remarks: materialIssue.remarks,
      enteredBy: appUser.name,
    })
    .from(materialIssue)
    .innerJoin(materialBatch, eq(materialBatch.id, materialIssue.batchId))
    .leftJoin(jobCard, eq(jobCard.id, materialIssue.jobCardId))
    .leftJoin(appUser, eq(appUser.id, materialIssue.createdBy))
    .where(and(eq(materialBatch.materialId, materialId), isNull(materialIssue.deletedAt)));

  const adjustments = await db
    .select({
      id: materialAdjustment.id,
      no: materialAdjustment.adjustmentNo,
      on: materialAdjustment.adjustedOn,
      batchNo: materialBatch.batchNo,
      qty: materialAdjustment.qty,
      detail: materialAdjustment.reason,
      remarks: materialAdjustment.remarks,
      enteredBy: appUser.name,
    })
    .from(materialAdjustment)
    .innerJoin(materialBatch, eq(materialBatch.id, materialAdjustment.batchId))
    .leftJoin(appUser, eq(appUser.id, materialAdjustment.createdBy))
    .where(and(eq(materialBatch.materialId, materialId), isNull(materialAdjustment.deletedAt)));

  const rows: Movement[] = [
    ...issues.map((i) => ({ kind: "Issue" as const, ...i, qty: `-${i.qty}` })),
    ...adjustments.map((a) => ({
      kind: "Adjustment" as const,
      ...a,
      jobCardId: null,
      jcNo: null,
      jobRef: null,
    })),
  ];

  return rows.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.no < b.no ? 1 : -1));
}

/* -------------------------------------------------------------------------- */
/* The In/Out log — every movement in the store, for ADMIN (P4)                */
/* -------------------------------------------------------------------------- */

export type LogRow = {
  kind: MovementKind;
  id: string;
  no: string;
  /** The date the movement is dated — received, issued or counted on. */
  on: string;
  /** When the row was actually typed in, which is what the log is for. */
  enteredAt: Date;
  enteredBy: string | null;
  materialId: string;
  sku: string;
  name: string;
  unit: string;
  batchNo: string;
  /** Signed: In positive, Out negative, an adjustment as it was entered. */
  qty: string;
  /** Vendor for an In, department for an Out, reason for an adjustment. */
  detail: string | null;
  jobCardId: string | null;
  jcNo: string | null;
  jobRef: string | null;
  remarks: string | null;
};

export type LogFilters = {
  /** yyyy-mm-dd, inclusive, against the movement's own date. */
  from?: string;
  to?: string;
  kind?: MovementKind;
  query?: string;
};

/** More than this and the page stops being a page; narrow the dates. */
export const LOG_LIMIT = 500;

/**
 * Every receipt, issue and adjustment across the store, newest entry first —
 * the sheet's `InOut (Manual)` tab, read the other way round: not what stock
 * is, but what people have been typing into it. That is why every row says
 * who entered it and when, beside the date it claims to be for.
 *
 * Three selects merged here rather than one UNION: the three tables carry
 * different columns, and the per-material movements list already does it
 * this way. Each is capped at the limit before the merge, so the page is
 * bounded whatever the date range.
 */
export async function listMovementLog(
  filters: LogFilters = {},
): Promise<{ rows: LogRow[]; truncated: boolean }> {
  const q = filters.query?.trim();
  const matches = q
    ? or(ilike(material.sku, `%${q}%`), ilike(material.name, `%${q}%`))
    : undefined;
  const between = (col: PgColumn) =>
    and(
      filters.from ? gte(col, filters.from) : undefined,
      filters.to ? lte(col, filters.to) : undefined,
    );
  const wants = (kind: MovementKind) => !filters.kind || filters.kind === kind;

  const [ins, outs, adjs] = await Promise.all([
    wants("In")
      ? db
          .select({
            id: materialBatch.id,
            no: materialBatch.batchNo,
            on: materialBatch.receivedDate,
            enteredAt: materialBatch.createdAt,
            enteredBy: appUser.name,
            materialId: material.id,
            sku: material.sku,
            name: material.name,
            unit: material.unit,
            batchNo: materialBatch.batchNo,
            qty: materialBatch.qtyReceived,
            detail: grn.vendor,
            grnNo: grn.grnNo,
            jobRef: materialBatch.jobRef,
            remarks: materialBatch.remarks,
          })
          .from(materialBatch)
          .innerJoin(material, eq(material.id, materialBatch.materialId))
          .leftJoin(grn, eq(grn.id, materialBatch.grnId))
          .leftJoin(appUser, eq(appUser.id, materialBatch.createdBy))
          .where(and(isNull(materialBatch.deletedAt), between(materialBatch.receivedDate), matches))
          .orderBy(desc(materialBatch.createdAt))
          .limit(LOG_LIMIT)
      : [],
    wants("Out")
      ? db
          .select({
            id: materialIssue.id,
            no: materialIssue.issueNo,
            on: materialIssue.issuedOn,
            enteredAt: materialIssue.createdAt,
            enteredBy: appUser.name,
            materialId: material.id,
            sku: material.sku,
            name: material.name,
            unit: material.unit,
            batchNo: materialBatch.batchNo,
            qty: materialIssue.qty,
            detail: materialIssue.department,
            jobCardId: materialIssue.jobCardId,
            jcNo: jobCard.jcNo,
            jobRef: materialIssue.jobRef,
            remarks: materialIssue.remarks,
          })
          .from(materialIssue)
          .innerJoin(materialBatch, eq(materialBatch.id, materialIssue.batchId))
          .innerJoin(material, eq(material.id, materialBatch.materialId))
          .leftJoin(jobCard, eq(jobCard.id, materialIssue.jobCardId))
          .leftJoin(appUser, eq(appUser.id, materialIssue.createdBy))
          .where(and(isNull(materialIssue.deletedAt), between(materialIssue.issuedOn), matches))
          .orderBy(desc(materialIssue.createdAt))
          .limit(LOG_LIMIT)
      : [],
    wants("Adjustment")
      ? db
          .select({
            id: materialAdjustment.id,
            no: materialAdjustment.adjustmentNo,
            on: materialAdjustment.adjustedOn,
            enteredAt: materialAdjustment.createdAt,
            enteredBy: appUser.name,
            materialId: material.id,
            sku: material.sku,
            name: material.name,
            unit: material.unit,
            batchNo: materialBatch.batchNo,
            qty: materialAdjustment.qty,
            detail: materialAdjustment.reason,
            remarks: materialAdjustment.remarks,
          })
          .from(materialAdjustment)
          .innerJoin(materialBatch, eq(materialBatch.id, materialAdjustment.batchId))
          .innerJoin(material, eq(material.id, materialBatch.materialId))
          .leftJoin(appUser, eq(appUser.id, materialAdjustment.createdBy))
          .where(and(isNull(materialAdjustment.deletedAt), between(materialAdjustment.adjustedOn), matches))
          .orderBy(desc(materialAdjustment.createdAt))
          .limit(LOG_LIMIT)
      : [],
  ]);

  const rows: LogRow[] = [
    ...ins.map(({ grnNo, ...b }) => ({
      kind: "In" as const,
      ...b,
      // A receipt with a GRN behind it is one line of that GRN; an opening
      // balance or a replayed ledger row has only its batch number.
      no: grnNo ?? b.batchNo,
      jobCardId: null,
      jcNo: null,
    })),
    ...outs.map((i) => ({ kind: "Out" as const, ...i, qty: `-${i.qty}` })),
    ...adjs.map((a) => ({
      kind: "Adjustment" as const,
      ...a,
      jobCardId: null,
      jcNo: null,
      jobRef: null,
    })),
  ];

  rows.sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime() || (a.no < b.no ? 1 : -1));
  return { rows: rows.slice(0, LOG_LIMIT), truncated: rows.length > LOG_LIMIT };
}

/** Paper issued against one job card — shown on the card's page (O3). */
export async function issuesForJobCard(jobCardId: string) {
  return db
    .select({
      id: materialIssue.id,
      issueNo: materialIssue.issueNo,
      issuedOn: materialIssue.issuedOn,
      qty: materialIssue.qty,
      batchNo: materialBatch.batchNo,
      sku: material.sku,
      name: material.name,
      unit: material.unit,
    })
    .from(materialIssue)
    .innerJoin(materialBatch, eq(materialBatch.id, materialIssue.batchId))
    .innerJoin(material, eq(material.id, materialBatch.materialId))
    .where(and(eq(materialIssue.jobCardId, jobCardId), isNull(materialIssue.deletedAt)))
    .orderBy(desc(materialIssue.issuedOn));
}

/* -------------------------------------------------------------------------- */
/* GRNs                                                                        */
/* -------------------------------------------------------------------------- */

export async function listGrns() {
  const lines = db
    .select({
      grnId: materialBatch.grnId,
      lineCount: sql<number>`count(*)::int`.as("line_count"),
    })
    .from(materialBatch)
    .where(isNull(materialBatch.deletedAt))
    .groupBy(materialBatch.grnId)
    .as("lines");

  return db
    .select({
      id: grn.id,
      grnNo: grn.grnNo,
      receivedDate: grn.receivedDate,
      vendor: grn.vendor,
      invoiceNo: grn.invoiceNo,
      invoiceUrl: grn.invoiceUrl,
      lineCount: sql<number>`coalesce(${lines.lineCount}, 0)::int`,
    })
    .from(grn)
    .leftJoin(lines, eq(lines.grnId, grn.id))
    .where(isNull(grn.deletedAt))
    .orderBy(desc(grn.receivedDate), desc(grn.grnNo));
}

/* -------------------------------------------------------------------------- */
/* The job card's paper picker (O2)                                            */
/* -------------------------------------------------------------------------- */

export const ADC_WINDOW_KEY = "material_adc_window_days";

export async function getAdcWindowDays(): Promise<number> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(and(eq(appSetting.key, ADC_WINDOW_KEY), isNull(appSetting.deletedAt)))
    .limit(1);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : 90;
}

export const GSM_TOLERANCE_KEY = "paper_gsm_tolerance_pct";

export async function getGsmTolerancePct(): Promise<number> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(and(eq(appSetting.key, GSM_TOLERANCE_KEY), isNull(appSetting.deletedAt)))
    .limit(1);
  const parsed = Number(row?.value);
  // Same fallback as the seed in 0039.
  return Number.isFinite(parsed) ? parsed : 5;
}

export type PaperOption = {
  id: string;
  sku: string;
  name: string;
  typeId: string;
  typeName: string;
  size: string | null;
  gsm: number | null;
  finish: string | null;
  closingStock: string;
};

/**
 * Every active PAPER with stock figures, for the release form.
 *
 * "Paper" is the category named Paper — the one category the card cares
 * about (O5). All of it is sent to the browser and narrowed there by type,
 * size and GSM as the planner types, because the alternative is a round trip
 * per keystroke on a form that already has a dozen fields.
 */
export async function listPaperOptions(): Promise<PaperOption[]> {
  return db
    .select({
      id: vMaterialStock.materialId,
      sku: vMaterialStock.sku,
      name: vMaterialStock.name,
      typeId: vMaterialStock.typeId,
      typeName: vMaterialStock.typeName,
      size: vMaterialStock.size,
      gsm: vMaterialStock.gsm,
      finish: vMaterialStock.finish,
      closingStock: vMaterialStock.closingStock,
    })
    .from(vMaterialStock)
    .where(
      and(
        eq(vMaterialStock.isActive, true),
        or(eq(vMaterialStock.categoryName, "Paper"), eq(vMaterialStock.unit, "Sheet")),
      ),
    )
    .orderBy(asc(vMaterialStock.typeName), asc(vMaterialStock.size), asc(vMaterialStock.gsm));
}
