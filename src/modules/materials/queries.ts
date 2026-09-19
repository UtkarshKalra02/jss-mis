import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

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
export async function listStock(opts: { categoryId?: string } = {}): Promise<StockRow[]> {
  return db
    .select()
    .from(vMaterialStock)
    .where(opts.categoryId ? eq(vMaterialStock.categoryId, opts.categoryId) : undefined)
    .orderBy(
      desc(vMaterialStock.needsReorder),
      asc(vMaterialStock.categoryName),
      asc(vMaterialStock.typeName),
      asc(vMaterialStock.name),
    );
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
    })
    .from(vMaterialBatchStock)
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
    })
    .from(vMaterialBatchStock)
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
    })),
  ];

  return rows.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.no < b.no ? 1 : -1));
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
