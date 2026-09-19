/**
 * One-time load of the store from the "IMS Jss the print zone" sheet
 * (decision O7).
 *
 *   npx tsx scripts/import-materials.ts data/ims-2026-09-19.xlsx [--dry-run]
 *
 * Reads three tabs of an .xlsx export of the sheet:
 *
 *   Item List      → material_category: the code is what that category's SKUs
 *                    start with (the labels are the record; CFG_CODES is only
 *                    consulted for a category no item uses yet).
 *   Item List      → material_type (from the SKU's middle segment + the
 *                    Material column) and material (every row with a SKU).
 *   GRN            → grn, keeping the sheet's GRN ids as grn_no.
 *   Paper Batches  → material_batch, LIVE BATCHES ONLY (remaining > 0), with
 *                    qty_received as the sheet had it and, where issues had
 *                    already been made against the batch, ONE reconciling
 *                    adjustment so that remaining computes to the sheet's
 *                    figure. Exhausted batches and the issue/adjustment
 *                    history stay in the sheet; this loads what is on the
 *                    shelf, not what happened to it.
 *
 * The opening figures are Utkarsh's, confirmed 19 Sep 2026 ("they are
 * correct"), and every imported row's remark says where it came from.
 *
 * A batch whose SKU is missing from the Item List gets a master row made
 * from the batch line (name, unit; category and type from the SKU's codes),
 * with a remark saying so. The one such case on 19 Sep 2026 was P-DUP-995.
 *
 * IDEMPOTENT on sku, grn_no and batch_no: re-running adds what is missing and
 * leaves what exists untouched, so a second download of the sheet a week
 * later is the same command.
 *
 * Runs against whatever .env.local points at. For production, the way
 * DEPLOYMENT.md prescribes for migrations:
 *   DOTENV_CONFIG_PATH=.env.production.local npx tsx scripts/import-materials.ts data/…xlsx
 */
import { config } from "dotenv";
import ExcelJS from "exceljs";

config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.local" });

/*
 * This script talks to the database and nothing else. src/lib/env.ts insists
 * on AUTH_SECRET before src/db will load, and .env.production.local
 * deliberately holds only the two connection strings (DEPLOYMENT.md §2: the
 * production signing secret never lives on a laptop). A placeholder here is
 * honest — no session is ever signed by this process — and beats copying a
 * real secret into a file to run a data load.
 */
process.env.AUTH_SECRET ??= "unused-by-import-script";

type DbModule = typeof import("../src/db");
type AuditModule = typeof import("../src/db/audit");
type SchemaModule = typeof import("../src/db/schema");

const file = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!file) {
  console.error("Usage: npx tsx scripts/import-materials.ts <sheet.xlsx> [--dry-run]");
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Cell helpers                                                                */
/* -------------------------------------------------------------------------- */

type Cell = ExcelJS.CellValue;

function text(c: Cell): string | null {
  if (c === null || c === undefined) return null;
  if (typeof c === "object") {
    if ("result" in c) return text(c.result as Cell);
    if ("text" in c) return text((c as { text: Cell }).text);
    if ("hyperlink" in c) return String((c as { hyperlink: string }).hyperlink);
    if (c instanceof Date) return c.toISOString();
    if ("richText" in c) return (c as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  const s = String(c).trim();
  if (s === "" || s === "–" || s === "-" || s === "—") return null;
  return s;
}

function num(c: Cell): number | null {
  const s = text(c);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "330Gsm" → 330, "12Mic" → 12, "300" → 300. */
function gsm(c: Cell): number | null {
  const s = text(c);
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? Math.round(Number(m[1])) : null;
}

/** "… 250Gsm …" or "… 12 Mic …" inside a free-text name → 250 / 12. */
function gsmInName(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:gsm|mic)/i.exec(name);
  return m ? Math.round(Number(m[1])) : null;
}

/** A Date cell, an ISO string, or dd/mm/yyyy → yyyy-mm-dd (IST calendar day). */
function isoDate(c: Cell, fallback: string): string {
  if (c instanceof Date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(c);
  }
  const s = text(c);
  if (!s) return fallback;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? fallback
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

const money2 = (n: number | null) => (n === null ? null : n.toFixed(2));

/* -------------------------------------------------------------------------- */
/* Read the workbook                                                           */
/* -------------------------------------------------------------------------- */

type ItemRow = {
  name: string;
  category: string;
  materialName: string;
  size: string | null;
  gsm: number | null;
  colour: string | null;
  finish: string | null;
  unit: string;
  sku: string;
  active: boolean;
  adc: number | null;
  leadTime: number | null;
  moq: number | null;
  maxLevel: number | null;
  inTransit: number | null;
};

type BatchRow = {
  batchNo: string;
  received: string;
  sku: string;
  /** The batch line's own description and unit — used when the Item List
      has no row for the SKU (P-DUP-995 was such a case). */
  itemName: string | null;
  unit: string | null;
  qtyReceived: number;
  remaining: number;
  remark: string | null;
  grnNo: string | null;
};

type GrnRow = {
  grnNo: string;
  date: string;
  vendor: string;
  invoiceNo: string | null;
  invoiceUrl: string | null;
  remark: string | null;
};

const UNITS = new Set(["Sheet", "Kg", "Ltr", "Pc", "Pkt"]);

async function readSheet(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const codes = new Map<string, string>();
  const cfg = wb.getWorksheet("CFG_CODES");
  if (cfg) {
    cfg.eachRow((row, n) => {
      if (n === 1) return;
      const [type, value, code] = [text(row.getCell(1).value), text(row.getCell(2).value), text(row.getCell(3).value)];
      if (type === "CATEGORY" && value && code) codes.set(value, code);
    });
  }

  const items: ItemRow[] = [];
  const skipped: string[] = [];
  const il = wb.getWorksheet("Item List");
  if (!il) throw new Error("No 'Item List' tab in the workbook.");
  il.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => row.getCell(i).value;
    const sku = text(v(9));
    const name = text(v(1));
    if (!sku || !name) return;
    const unit = text(v(8)) ?? "";
    const category = text(v(2)) ?? "";
    const materialName = text(v(3)) ?? "";
    if (!UNITS.has(unit) || !category || !materialName) {
      skipped.push(`${sku} (${name}): unit "${unit}", category "${category}", material "${materialName}"`);
      return;
    }
    items.push({
      name,
      category,
      materialName,
      size: text(v(4)),
      gsm: gsm(v(5)),
      colour: text(v(6)),
      finish: text(v(7)),
      unit,
      sku,
      active: (text(v(10)) ?? "Yes").toLowerCase() !== "no",
      adc: num(v(11)),
      leadTime: num(v(12)) === null ? null : Math.round(num(v(12))!),
      moq: num(v(14)),
      maxLevel: num(v(15)),
      inTransit: num(v(16)),
    });
  });

  const grns: GrnRow[] = [];
  const gs = wb.getWorksheet("GRN");
  gs?.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => row.getCell(i).value;
    const grnNo = text(v(1));
    if (!grnNo) return;
    grns.push({
      grnNo,
      date: isoDate(v(2), today),
      vendor: text(v(3)) ?? "Unknown vendor",
      invoiceNo: text(v(4)),
      invoiceUrl: text(v(5)),
      remark: text(v(6)),
    });
  });

  const batches: BatchRow[] = [];
  const pb = wb.getWorksheet("Paper Batches");
  pb?.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => row.getCell(i).value;
    const batchNo = text(v(1));
    const sku = text(v(3));
    if (!batchNo || !sku) return;
    const qtyReceived = num(v(6)) ?? 0;
    const remaining = num(v(8)) ?? 0;
    batches.push({
      batchNo,
      received: isoDate(v(2), today),
      sku,
      itemName: text(v(4)),
      unit: text(v(5)),
      qtyReceived,
      remaining,
      remark: text(v(10)),
      grnNo: text(v(12)),
    });
  });

  return { codes, items, skipped, grns, batches };
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  const { codes, items, skipped, grns, batches } = await readSheet(file!);
  const liveBatches = batches.filter((b) => b.remaining > 0);

  console.log(`Read ${items.length} materials (${skipped.length} skipped), ${grns.length} GRNs, ${batches.length} batches (${liveBatches.length} with stock).`);
  for (const s of skipped) console.log(`  skip: ${s}`);

  // Categories. The code is what the SKUs actually start with — the config
  // tab is consulted only for a category no item uses yet. (The config maps
  // "Coating" to C and the SKUs say CO; the SKUs are the record on the
  // labels, so they win.)
  const seen = new Map<string, Map<string, number>>();
  for (const it of items) {
    const m = /^([A-Z0-9]+)-/i.exec(it.sku);
    if (!m) continue;
    const per = seen.get(it.category) ?? new Map<string, number>();
    per.set(m[1]!.toUpperCase(), (per.get(m[1]!.toUpperCase()) ?? 0) + 1);
    seen.set(it.category, per);
  }
  const categoryCodes = new Map<string, string>();
  for (const [name, per] of seen) {
    const [best] = [...per].sort((a, b) => b[1] - a[1])[0]!;
    categoryCodes.set(name, best);
  }
  for (const [name, code] of codes) if (!categoryCodes.has(name)) categoryCodes.set(name, code);
  {
    const used = new Map<string, string>();
    for (const [name, code] of categoryCodes) {
      if (used.has(code)) throw new Error(`Category code ${code} is used by both ${used.get(code)} and ${name}.`);
      used.set(code, name);
    }
  }

  // Types: the SKU's middle segment IS the code; the Material column is the name.
  const typeCodes = new Map<string, string>();
  for (const it of items) {
    const m = /^([A-Z0-9]+)-([A-Z0-9]+)-\d+$/i.exec(it.sku);
    if (!m) {
      skipped.push(`${it.sku}: not a CAT-TYPE-NNN code`);
      continue;
    }
    const code = m[2]!.toUpperCase();
    if (!typeCodes.has(code)) typeCodes.set(code, it.materialName);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    console.log("Categories:", [...categoryCodes].map(([n, c]) => `${n}=${c}`).join(", "));
    console.log("Types:", [...typeCodes].map(([c, n]) => `${c}=${n}`).join(", "));
    const bySku = new Map<string, number>();
    for (const b of liveBatches) bySku.set(b.sku, (bySku.get(b.sku) ?? 0) + b.remaining);
    const orphan = [...bySku.keys()].filter((s) => !items.some((i) => i.sku === s));
    console.log(
      `Live stock on ${bySku.size} SKUs; ${orphan.length} batch SKUs with no Item List row (a master row will be created from the batch line):`,
      orphan.join(", ") || "none",
    );
    const reconciling = liveBatches.filter((b) => b.remaining !== b.qtyReceived).length;
    console.log(`${reconciling} live batches need a reconciling adjustment (issued before import).`);
    process.exit(0);
  }

  const { db }: DbModule = await import("../src/db");
  const { SYSTEM_ACTOR, auditedInsert }: AuditModule = await import("../src/db/audit");
  const schema: SchemaModule = await import("../src/db/schema");
  const { eq, isNull, and, sql } = await import("drizzle-orm");

  const counts = { categories: 0, types: 0, materials: 0, grns: 0, batches: 0, adjustments: 0, existing: 0 };
  const SOURCE = "Imported from IMS sheet 19 Sep 2026";

  await db.transaction(async (tx) => {
    // Categories
    const catId = new Map<string, string>();
    let seq = 0;
    for (const [name, code] of categoryCodes) {
      seq += 10;
      const [existing] = await tx
        .select({ id: schema.materialCategory.id })
        .from(schema.materialCategory)
        .where(and(eq(schema.materialCategory.code, code), isNull(schema.materialCategory.deletedAt)))
        .limit(1);
      if (existing) {
        catId.set(name, existing.id);
        continue;
      }
      const row = await auditedInsert(SYSTEM_ACTOR, schema.materialCategory, { code, name, sequence: seq }, tx);
      catId.set(name, row.id);
      counts.categories++;
    }

    // Types
    const typeId = new Map<string, string>();
    seq = 0;
    for (const [code, name] of typeCodes) {
      seq += 10;
      const [existing] = await tx
        .select({ id: schema.materialType.id })
        .from(schema.materialType)
        .where(and(eq(schema.materialType.code, code), isNull(schema.materialType.deletedAt)))
        .limit(1);
      if (existing) {
        typeId.set(code, existing.id);
        continue;
      }
      const row = await auditedInsert(SYSTEM_ACTOR, schema.materialType, { code, name, sequence: seq }, tx);
      typeId.set(code, row.id);
      counts.types++;
    }

    // Materials
    const materialId = new Map<string, string>();
    for (const it of items) {
      const m = /^([A-Z0-9]+)-([A-Z0-9]+)-\d+$/i.exec(it.sku);
      if (!m) continue;
      const [existing] = await tx
        .select({ id: schema.material.id })
        .from(schema.material)
        .where(and(eq(schema.material.sku, it.sku), isNull(schema.material.deletedAt)))
        .limit(1);
      if (existing) {
        materialId.set(it.sku, existing.id);
        counts.existing++;
        continue;
      }
      const row = await auditedInsert(
        SYSTEM_ACTOR,
        schema.material,
        {
          sku: it.sku,
          name: it.name,
          categoryId: catId.get(it.category)!,
          typeId: typeId.get(m[2]!.toUpperCase())!,
          size: it.size,
          gsm: it.gsm,
          colour: it.colour,
          finish: it.finish,
          unit: it.unit as "Sheet",
          isActive: it.active,
          averageDailyConsumption: money2(it.adc),
          leadTimeDays: it.leadTime,
          minOrderQty: money2(it.moq),
          maxLevel: money2(it.maxLevel),
          inTransitQty: money2(it.inTransit),
          remarks: SOURCE,
        },
        tx,
      );
      materialId.set(it.sku, row.id);
      counts.materials++;
    }

    // GRNs
    const grnId = new Map<string, string>();
    for (const g of grns) {
      const [existing] = await tx
        .select({ id: schema.grn.id })
        .from(schema.grn)
        .where(and(eq(schema.grn.grnNo, g.grnNo), isNull(schema.grn.deletedAt)))
        .limit(1);
      if (existing) {
        grnId.set(g.grnNo, existing.id);
        continue;
      }
      const row = await auditedInsert(
        SYSTEM_ACTOR,
        schema.grn,
        {
          grnNo: g.grnNo,
          receivedDate: g.date,
          vendor: g.vendor,
          invoiceNo: g.invoiceNo,
          invoiceUrl: g.invoiceUrl && /^https?:\/\//i.test(g.invoiceUrl) ? g.invoiceUrl : null,
          remarks: [g.remark, SOURCE].filter(Boolean).join(" · "),
        },
        tx,
      );
      grnId.set(g.grnNo, row.id);
      counts.grns++;
    }

    // A batch whose SKU the Item List never listed. The batch line carries a
    // name and a unit, and the SKU's own codes say category and type, so the
    // master row is made from those and says so in its remark. Reported,
    // because a mistyped SKU on a batch would arrive here too.
    for (const b of liveBatches) {
      if (materialId.has(b.sku)) continue;
      const m = /^([A-Z0-9]+)-([A-Z0-9]+)-\d+$/i.exec(b.sku);
      const cat = m ? [...categoryCodes].find(([, code]) => code === m[1]!.toUpperCase()) : undefined;
      const typ = m ? typeId.get(m[2]!.toUpperCase()) : undefined;
      const unit = b.unit && UNITS.has(b.unit) ? b.unit : null;
      if (!m || !cat || !typ || !unit || !b.itemName) {
        console.log(`  skip batch ${b.batchNo}: no material ${b.sku}, and not enough on the line to create one`);
        continue;
      }
      const [existing] = await tx
        .select({ id: schema.material.id })
        .from(schema.material)
        .where(and(eq(schema.material.sku, b.sku), isNull(schema.material.deletedAt)))
        .limit(1);
      if (existing) {
        materialId.set(b.sku, existing.id);
        continue;
      }
      const size = /(\d+(?:\.\d+)?\s*[xX]\s*\d+(?:\.\d+)?)/.exec(b.itemName)?.[1]?.replace(/\s+/g, "").toUpperCase() ?? null;
      const row = await auditedInsert(
        SYSTEM_ACTOR,
        schema.material,
        {
          sku: b.sku,
          name: b.itemName,
          categoryId: catId.get(cat[0])!,
          typeId: typ,
          size,
          // From the NAME, so it must say "Gsm"/"Mic" — the bare first number
          // in "Duplex 31.5x41.5 250Gsm" is the size.
          gsm: gsmInName(b.itemName),
          unit: unit as "Sheet",
          isActive: true,
          remarks: `Created from batch ${b.batchNo} — the SKU was not in the sheet's Item List. Check size, GSM and colour. ${SOURCE}`,
        },
        tx,
      );
      materialId.set(b.sku, row.id);
      counts.materials++;
      console.log(`  created material ${b.sku} "${b.itemName}" from batch ${b.batchNo} (not in Item List)`);
    }

    // Live batches, with a reconciling adjustment where the sheet had already
    // issued from them.
    const inserted: { batchNo: string; remaining: number }[] = [];
    for (const b of liveBatches) {
      const mId = materialId.get(b.sku);
      if (!mId) continue;
      const [existing] = await tx
        .select({ id: schema.materialBatch.id })
        .from(schema.materialBatch)
        .where(and(eq(schema.materialBatch.batchNo, b.batchNo), isNull(schema.materialBatch.deletedAt)))
        .limit(1);
      if (existing) continue;

      const row = await auditedInsert(
        SYSTEM_ACTOR,
        schema.materialBatch,
        {
          batchNo: b.batchNo,
          grnId: b.grnNo ? (grnId.get(b.grnNo) ?? null) : null,
          materialId: mId,
          receivedDate: b.received,
          qtyReceived: money2(b.qtyReceived)!,
          remarks: [b.remark, SOURCE].filter(Boolean).join(" · "),
        },
        tx,
      );
      counts.batches++;
      inserted.push({ batchNo: b.batchNo, remaining: b.remaining });

      const diff = b.remaining - b.qtyReceived;
      if (diff !== 0) {
        await auditedInsert(
          SYSTEM_ACTOR,
          schema.materialAdjustment,
          {
            adjustmentNo: `MA-IMPORT-${b.batchNo}`,
            batchId: row.id,
            adjustedOn: b.received,
            qty: money2(diff)!,
            reason: "Other",
            remarks: `Issued before import — brings the batch to the sheet's remaining of ${b.remaining}. History is in the IMS sheet.`,
          },
          tx,
        );
        counts.adjustments++;
      }
    }

    // Sanity: every batch THIS RUN wrote must show the sheet's remaining in
    // the view. Per batch, not per SKU — a SKU loaded on an earlier run has
    // been issued from since, and the sheet is no longer its record, but a
    // batch just written has exactly one right answer. Batches skipped above
    // (no master row) are reported, not counted.
    const mismatches: string[] = [];
    for (const b of inserted) {
      const [r] = (
        await tx.execute(
          sql`select qty_remaining from v_material_batch_stock where batch_no = ${b.batchNo}`,
        )
      ).rows as { qty_remaining: string }[];
      if (!r || Math.abs(Number(r.qty_remaining) - b.remaining) > 0.001) {
        mismatches.push(`${b.batchNo}: sheet ${b.remaining}, view ${r?.qty_remaining ?? "missing"}`);
      }
    }
    if (mismatches.length > 0) {
      console.error("Batch stock does not match the sheet — rolling back:\n  " + mismatches.join("\n  "));
      throw new Error("Import aborted: stock mismatch.");
    }
  });

  console.log("\nDone:", counts);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
