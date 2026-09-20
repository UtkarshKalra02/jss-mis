"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import {
  auditedInsert,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
  type Tx,
} from "@/db/audit";
import {
  appSetting,
  grn,
  material,
  materialAdjustment,
  materialBatch,
  materialCategory,
  materialIssue,
  materialType,
} from "@/db/schema";
import { actionError } from "@/lib/action-error";
import { todayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";

import {
  ADC_WINDOW_KEY,
  GSM_TOLERANCE_KEY,
  batchRemaining,
  getBatch,
  getGsmTolerancePct,
  getMaterial,
  skusUnderPrefix,
} from "./queries";
import { formatSku, nextSkuNumber, skuPrefix } from "./sku";
import {
  adjustmentSchema,
  grnSchema,
  issueSchema,
  materialSchema,
  type MaterialInput,
} from "./validation";

/**
 * Store writes (section O).
 *
 * ADMIN, PLANNER and DATA_ENTRY (O5). Every write goes through the audit
 * wrapper; nothing here touches a stock figure, because there is none to
 * touch — closing stock and batch remaining are the views' (0039).
 */

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  redirectTo?: string;
};

const ok = (message?: string, redirectTo?: string): FormState => ({
  ok: true,
  error: null,
  message,
  redirectTo,
});
const fail = (error: string): FormState => ({ ok: false, error });

async function requireStoreWriter(): Promise<Actor> {
  const user = await requireAccess("material", "write");
  return { id: user.id, role: user.role };
}

const orNull = <T>(v: T | undefined): T | null => v ?? null;
const idOrNull = (v: string | undefined) => (v && v.length > 0 ? v : null);

function firstIssue(error: { issues: { message: string; path: PropertyKey[] }[] }): string {
  const issue = error.issues[0]!;
  const row = issue.path[0] === "lines" ? ` (line ${Number(issue.path[1]) + 1})` : "";
  return `${issue.message}${row}`;
}

/* -------------------------------------------------------------------------- */
/* Material master                                                             */
/* -------------------------------------------------------------------------- */

function parseMaterial(formData: FormData) {
  return materialSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    typeId: formData.get("typeId"),
    size: formData.get("size"),
    gsm: formData.get("gsm"),
    colour: formData.get("colour"),
    finish: formData.get("finish"),
    unit: formData.get("unit"),
    isActive: formData.get("isActive") !== "false",
    reorderMethod: formData.get("reorderMethod") ?? "On demand",
    leadTimeDays: formData.get("leadTimeDays"),
    minOrderQty: formData.get("minOrderQty"),
    safetyFactor: formData.get("safetyFactor"),
    issueIntervalDays: formData.get("issueIntervalDays"),
    inTransitQty: formData.get("inTransitQty"),
    reorderNote: formData.get("reorderNote") ?? "",
    imageUrl: formData.get("imageUrl"),
    remarks: formData.get("remarks"),
  });
}

/**
 * The reorder figures, from the form (P2). The manual note keeps its date
 * from when it was first set and gets a new one when it changes.
 */
function reorderFields(
  v: MaterialInput,
  existing: { reorderNote: string | null; reorderNoteOn: string | null } | null,
) {
  const note = v.reorderNote ? v.reorderNote : null;
  const noteOn = note === null ? null : note === existing?.reorderNote ? existing.reorderNoteOn : todayIST();
  return {
    reorderMethod: v.reorderMethod,
    leadTimeDays: orNull(v.leadTimeDays),
    minOrderQty: orNull(v.minOrderQty),
    safetyFactor: orNull(v.safetyFactor),
    issueIntervalDays: orNull(v.issueIntervalDays),
    inTransitQty: orNull(v.inTransitQty),
    reorderNote: note,
    reorderNoteOn: noteOn,
    imageUrl: orNull(v.imageUrl),
  };
}

/**
 * Allocates the next SKU under category-type (O1), inside the transaction.
 *
 * An advisory lock on the prefix serialises two people adding the same kind
 * of board at once; without it both read max 116 and both become 117, and
 * the partial unique index turns the second into a database error the person
 * cannot act on.
 */
export async function allocateSku(tx: Tx, categoryId: string, typeId: string): Promise<string> {
  const [cat] = await tx
    .select({ code: materialCategory.code })
    .from(materialCategory)
    .where(sql`${materialCategory.id} = ${categoryId}`)
    .limit(1);
  const [typ] = await tx
    .select({ code: materialType.code })
    .from(materialType)
    .where(sql`${materialType.id} = ${typeId}`)
    .limit(1);
  if (!cat || !typ) throw new Error("Choose a category and a material type.");

  const prefix = skuPrefix(cat.code, typ.code);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${prefix}))`);
  const existing = await skusUnderPrefix(prefix, tx);
  return formatSku(prefix, nextSkuNumber(existing, prefix));
}

export async function createMaterialAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireStoreWriter();
    const parsed = parseMaterial(formData);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;

    const created = await db.transaction(async (tx) => {
      const sku = await allocateSku(tx, v.categoryId, v.typeId);
      return auditedInsert(
        actor,
        material,
        {
          sku,
          name: v.name,
          categoryId: v.categoryId,
          typeId: v.typeId,
          size: orNull(v.size),
          gsm: orNull(v.gsm),
          colour: orNull(v.colour),
          finish: orNull(v.finish),
          unit: v.unit,
          isActive: v.isActive,
          ...reorderFields(v, null),
          remarks: orNull(v.remarks),
        },
        tx,
      );
    });

    revalidatePath("/materials");
    return ok(`${created.sku} added.`, `/materials/${created.id}`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not add the material."));
  }
}

/**
 * Editing a material never changes its SKU. Category and type are part of the
 * code, and a code that changes under a batch, a card or a printed label is a
 * code nobody can trust — so both are read-only after creation, and a wrong
 * one is fixed by retiring the item and adding it again.
 */
export async function updateMaterialAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireStoreWriter();
    const id = String(formData.get("id") ?? "");
    const existing = await getMaterial(id);
    if (!existing) return fail("That material no longer exists.");

    const parsed = parseMaterial(
      (() => {
        // The form does not post category/type; keep the stored ones.
        const fd = new FormData();
        formData.forEach((value, key) => fd.append(key, value));
        fd.set("categoryId", existing.categoryId);
        fd.set("typeId", existing.typeId);
        return fd;
      })(),
    );
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;

    await auditedUpdate(actor, material, id, {
      name: v.name,
      size: orNull(v.size),
      gsm: orNull(v.gsm),
      colour: orNull(v.colour),
      finish: orNull(v.finish),
      unit: v.unit,
      isActive: v.isActive,
      ...reorderFields(v, existing),
      remarks: orNull(v.remarks),
    });

    revalidatePath("/materials");
    revalidatePath(`/materials/${id}`);
    return ok("Saved.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the material."));
  }
}

/* -------------------------------------------------------------------------- */
/* GRN                                                                         */
/* -------------------------------------------------------------------------- */

const LINE_FIELDS = ["materialId", "qty", "lineJobRef", "lineRemarks"] as const;

function parseLines(formData: FormData) {
  const cols = Object.fromEntries(
    LINE_FIELDS.map((f) => [f, formData.getAll(f).map(String)]),
  ) as Record<(typeof LINE_FIELDS)[number], string[]>;
  return cols.materialId.map((_, i) => ({
    materialId: cols.materialId[i] ?? "",
    qty: cols.qty[i] ?? "",
    jobRef: cols.lineJobRef[i] ?? "",
    remarks: cols.lineRemarks[i] ?? "",
  }));
}

/**
 * A receipt and its batches, in one transaction. Batch numbers are the GRN
 * number plus the line: GRN-2026-0012/1. In-transit on each material is NOT
 * touched here — it is a hand figure (materials.ts) and the form reminds the
 * person to clear it.
 */
export async function createGrnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireStoreWriter();
    const parsed = grnSchema.safeParse({
      receivedDate: formData.get("receivedDate"),
      vendor: formData.get("vendor"),
      invoiceNo: formData.get("invoiceNo"),
      invoiceUrl: formData.get("invoiceUrl"),
      remarks: formData.get("remarks"),
      lines: parseLines(formData),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;

    const created = await db.transaction(async (tx) => {
      const grnNo = await allocateNumber(tx, "GRN", v.receivedDate);
      const header = await auditedInsert(
        actor,
        grn,
        {
          grnNo,
          receivedDate: v.receivedDate,
          vendor: v.vendor,
          invoiceNo: orNull(v.invoiceNo),
          invoiceUrl: orNull(v.invoiceUrl),
          remarks: orNull(v.remarks),
        },
        tx,
      );

      let line = 0;
      for (const l of v.lines) {
        line += 1;
        await auditedInsert(
          actor,
          materialBatch,
          {
            batchNo: `${grnNo}/${line}`,
            grnId: header.id,
            materialId: l.materialId,
            receivedDate: v.receivedDate,
            qtyReceived: l.qty,
            jobRef: orNull(l.jobRef),
            remarks: orNull(l.remarks),
          },
          tx,
        );
      }
      return header;
    });

    revalidatePath("/materials");
    return ok(
      `${created.grnNo} received: ${v.lines.length} line${v.lines.length === 1 ? "" : "s"}.`,
      "/materials",
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the receipt."));
  }
}

/* -------------------------------------------------------------------------- */
/* Issue and adjustment                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Material leaving the store. The database refuses more than the batch has
 * (0039); the message it raises names the batch and what is left, and
 * actionError passes it through as a sentence.
 */
export async function createIssueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireStoreWriter();
    const parsed = issueSchema.safeParse({
      batchId: formData.get("batchId"),
      issuedOn: formData.get("issuedOn"),
      qty: formData.get("qty"),
      department: formData.get("department"),
      jobCardId: formData.get("jobCardId"),
      jobRef: formData.get("jobRef"),
      remarks: formData.get("remarks"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;

    const batch = await getBatch(v.batchId);
    if (!batch) return fail("That batch no longer exists.");

    // The database refuses this too (0039). Asking first turns the trigger's
    // exception into a sentence — the same shape as F13 — because actionError
    // deliberately never quotes what a RAISE said.
    const left = await batchRemaining(v.batchId);
    if (left !== null && Number(v.qty) > left) {
      return fail(
        `${batch.batchNo} has only ${left} ${batch.unit} left; cannot issue ${v.qty}. If the count is wrong, record an adjustment first — or issue the rest from another batch.`,
      );
    }

    // Another job's reserved paper (P3): allowed, and written on the issue,
    // the way the sheet's ⚠️ Warning rows did.
    const otherJob =
      batch.jobRef && batch.jobRef.trim().toLowerCase() !== (v.jobRef ?? "").trim().toLowerCase()
        ? batch.jobRef
        : null;
    const remarks = [
      otherJob ? `Taken from paper reserved for job "${otherJob}".` : null,
      v.remarks,
    ]
      .filter(Boolean)
      .join(" · ");

    const created = await db.transaction(async (tx) =>
      auditedInsert(
        actor,
        materialIssue,
        {
          issueNo: await allocateNumber(tx, "MI", v.issuedOn),
          batchId: v.batchId,
          issuedOn: v.issuedOn,
          qty: v.qty,
          department: orNull(v.department),
          jobCardId: idOrNull(v.jobCardId),
          jobRef: orNull(v.jobRef),
          remarks: remarks || null,
        },
        tx,
      ),
    );

    revalidatePath("/materials");
    revalidatePath(`/materials/${batch.materialId}`);
    if (created.jobCardId) revalidatePath(`/job-cards/${created.jobCardId}`);
    return ok(
      `${created.issueNo}: ${v.qty} ${batch.unit} of ${batch.sku} issued from ${batch.batchNo}.`,
      created.jobCardId ? `/job-cards/${created.jobCardId}` : `/materials/${batch.materialId}`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not record the issue."));
  }
}

export async function createAdjustmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireStoreWriter();
    const parsed = adjustmentSchema.safeParse({
      batchId: formData.get("batchId"),
      adjustedOn: formData.get("adjustedOn"),
      qty: formData.get("qty"),
      reason: formData.get("reason"),
      remarks: formData.get("remarks"),
    });
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;

    const batch = await getBatch(v.batchId);
    if (!batch) return fail("That batch no longer exists.");

    const created = await db.transaction(async (tx) =>
      auditedInsert(
        actor,
        materialAdjustment,
        {
          adjustmentNo: await allocateNumber(tx, "MA", v.adjustedOn),
          batchId: v.batchId,
          adjustedOn: v.adjustedOn,
          qty: v.qty,
          reason: v.reason,
          remarks: orNull(v.remarks),
        },
        tx,
      ),
    );

    revalidatePath("/materials");
    revalidatePath(`/materials/${batch.materialId}`);
    return ok(
      `${created.adjustmentNo}: ${batch.batchNo} adjusted by ${v.qty} ${batch.unit}.`,
      `/materials/${batch.materialId}`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not record the adjustment."));
  }
}

/**
 * Removing an issue puts the material back — that is what removing a
 * mistaken issue means, and the view stops counting it the moment it is
 * soft-deleted. Server redirect for the J13 reason: the row's own page is
 * the material, which still exists, so a plain refresh would do; the redirect
 * keeps the confirmation on the page the person is looking at.
 */
export async function removeIssueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireStoreWriter();
    const id = String(formData.get("id") ?? "");
    const materialId = String(formData.get("materialId") ?? "");

    await auditedSoftDelete(actor, materialIssue, id);

    revalidatePath("/materials");
    revalidatePath(`/materials/${materialId}`);
    redirect(`/materials/${materialId}?removed=Issue%20removed%20%E2%80%94%20stock%20restored.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not remove the issue."));
  }
}

/* -------------------------------------------------------------------------- */
/* The GSM tolerance (O2) — ADMIN, on the settings screen                      */
/* -------------------------------------------------------------------------- */

const tolerancePctSchema = z.coerce
  .number()
  .min(0, "Cannot be negative.")
  .max(50, "More than 50% would offer almost any board as a substitute.");

const windowDaysSchema = z.coerce
  .number()
  .int("Must be a whole number of days.")
  .min(7, "Fewer than seven days is noise, not a rate.")
  .max(365, "More than a year is not current consumption.");

/** The window daily consumption is averaged over (P2). ADMIN, on the settings screen. */
export async function saveAdcWindowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireAccess("admin", "write");
    const actor: Actor = { id: user.id, role: user.role };
    const parsed = windowDaysSchema.safeParse(formData.get("adcWindowDays"));
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const [row] = await db
      .select({ id: appSetting.id, value: appSetting.value })
      .from(appSetting)
      .where(sql`${appSetting.key} = ${ADC_WINDOW_KEY}`)
      .limit(1);
    if (!row) return fail("The consumption window setting row is missing. Re-run the migrations.");
    if (Number(row.value) === parsed.data) return ok("No change.");
    await auditedUpdate(actor, appSetting, row.id, { value: String(parsed.data) });
    revalidatePath("/admin/settings");
    revalidatePath("/materials");
    return ok(`Consumption window set to ${parsed.data} days.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the setting."));
  }
}

export async function saveGsmToleranceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireAccess("admin", "write");
    const actor: Actor = { id: user.id, role: user.role };

    const parsed = tolerancePctSchema.safeParse(formData.get("gsmTolerancePct"));
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const next = parsed.data;
    if (next === (await getGsmTolerancePct())) return ok("No change.");

    const [row] = await db
      .select({ id: appSetting.id })
      .from(appSetting)
      .where(sql`${appSetting.key} = ${GSM_TOLERANCE_KEY}`)
      .limit(1);
    if (!row) return fail("The GSM tolerance setting row is missing. Re-run the migrations.");

    await auditedUpdate(actor, appSetting, row.id, { value: String(next) });

    revalidatePath("/admin/settings");
    return ok(`Paper GSM tolerance set to ±${next}%.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the setting."));
  }
}
