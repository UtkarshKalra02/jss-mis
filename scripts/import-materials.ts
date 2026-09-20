/**
 * Loads the store from the "IMS Jss the print zone" sheet (section P).
 *
 *   npx tsx scripts/import-materials.ts data/ims-2026-09-19.xlsx [--dry-run]
 *
 * THE LEDGER IS THE RECORD. The sheet's `InOut (Manual)` tab — one row per
 * movement since 28 Jan 2026 — is what the factory's closing stock is summed
 * from, and it is what this loads. `replayLedger()` in
 * src/modules/materials/ledger.ts turns it into batches, issues and
 * adjustments (the rules are there, with tests). After writing, every SKU's
 * closing stock in v_material_stock is compared with the ledger's running sum
 * and the whole load rolls back on any difference.
 *
 * Also read:
 *   Item List         → material master, and the reorder figures the sheet's
 *                       "Calc Method" needs (method, lead time, MOQ, safety
 *                       factor, issue interval, in transit). ADC and max
 *                       level are NOT loaded: the view derives them.
 *   GRN               → grn rows; ledger receipts whose remark names one are
 *                       linked to it.
 *   Form responses 4  → a photo per SKU (latest wins).
 *   CFG_CODES         → category codes for categories no item uses yet.
 *
 * NOT read: `Paper Batches` and its issue/adjustment tabs. That layer was
 * only partly maintained and disagreed with the ledger on 33 SKUs (P1).
 *
 * Re-running: rows this importer wrote earlier (batch numbers IO-…, issue
 * numbers MI-IO-…, MA-IO-…, and the 19 Sep batch-tab load) are SOFT-deleted
 * first, along with any issue a person entered against one of those batches
 * — those are counted and printed, never silently lost — and the ledger is
 * replayed afresh. Rows a person entered against batches the importer did
 * not create are untouched.
 *
 * For production, as DEPLOYMENT.md prescribes for migrations:
 *   DOTENV_CONFIG_PATH=.env.production.local npx tsx scripts/import-materials.ts data/…xlsx
 */
import { config } from "dotenv";
import ExcelJS from "exceljs";

config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.local" });

/*
 * This script talks to the database and nothing else. src/lib/env.ts insists
 * on AUTH_SECRET before src/db will load, and .env.production.local
 * deliberately holds only the two connection strings (DEPLOYMENT.md §2). A
 * placeholder here is honest — no session is ever signed by this process.
 */
process.env.AUTH_SECRET ??= "unused-by-import-script";

import { replayLedger, type LedgerRow } from "../src/modules/materials/ledger";

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
    if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c.toISOString();
    if ("result" in c) return text(c.result as Cell);
    if ("text" in c) return text((c as { text: Cell }).text);
    if ("hyperlink" in c) return String((c as { hyperlink: string }).hyperlink);
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

/** "330Gsm" → 330, "12Mic" → 12, "300" → 300 (a dedicated Gsm/Mic cell). */
function gsmCell(c: Cell): number | null {
  const s = text(c);
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? Math.round(Number(m[1])) : null;
}

const IST = "Asia/Kolkata";
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());

/** A Date cell, an ISO string, or dd/mm/yyyy → yyyy-mm-dd (IST calendar day). */
function isoDate(c: Cell): string | null {
  if (c instanceof Date) {
    return Number.isNaN(c.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(c);
  }
  const s = text(c);
  if (!s) return null;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  // "2804/2026": day and month run together, as two ledger rows have it.
  const ddmm = /^(\d{2})(\d{2})\/(\d{4})$/.exec(s);
  if (ddmm) return `${ddmm[3]}-${ddmm[2]}-${ddmm[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
}

const money2 = (n: number | null) => (n === null ? null : n.toFixed(2));
const dec1 = (n: number | null) => (n === null ? null : n.toFixed(1));

/* -------------------------------------------------------------------------- */
/* Read the workbook                                                           */
/* -------------------------------------------------------------------------- */

type Method = "On demand" | "Consumption" | "Interval";

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
  method: Method;
  leadTime: number | null;
  factor: number | null;
  moq: number | null;
  interval: number | null;
  inTransit: number | null;
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

function methodOf(calc: string | null): Method {
  switch ((calc ?? "").trim().toLowerCase()) {
    case "yes":
      return "Consumption";
    case "interval":
      return "Interval";
    default:
      return "On demand";
  }
}

async function readSheet(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  const codes = new Map<string, string>();
  wb.getWorksheet("CFG_CODES")?.eachRow((row, n) => {
    if (n === 1) return;
    const [type, value, code] = [text(row.getCell(1).value), text(row.getCell(2).value), text(row.getCell(3).value)];
    if (type === "CATEGORY" && value && code) codes.set(value, code);
  });

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
      gsm: gsmCell(v(5)),
      colour: text(v(6)),
      finish: text(v(7)),
      unit,
      sku,
      active: (text(v(10)) ?? "Yes").toLowerCase() !== "no",
      method: methodOf(text(v(18))),
      leadTime: num(v(12)) === null ? null : Math.round(num(v(12))!),
      factor: num(v(13)),
      moq: num(v(14)),
      interval: num(v(19)),
      inTransit: num(v(16)),
    });
  });

  const grns: GrnRow[] = [];
  wb.getWorksheet("GRN")?.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => row.getCell(i).value;
    const grnNo = text(v(1));
    if (!grnNo) return;
    grns.push({
      grnNo,
      date: isoDate(v(2)) ?? todayIst(),
      vendor: text(v(3)) ?? "Unknown vendor",
      invoiceNo: text(v(4)),
      invoiceUrl: text(v(5)),
      remark: text(v(6)),
    });
  });

  const images = new Map<string, string>();
  wb.getWorksheet("Form responses 4")?.eachRow((row, n) => {
    if (n === 1) return;
    const sku = text(row.getCell(2).value);
    const url = text(row.getCell(4).value);
    if (sku && url && /^https?:\/\//i.test(url)) images.set(sku, url); // later rows win
  });

  const ledger: LedgerRow[] = [];
  const badRows: string[] = [];
  const led = wb.getWorksheet("InOut (Manual)");
  if (!led) throw new Error("No 'InOut (Manual)' tab in the workbook.");
  led.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => row.getCell(i).value;
    const sku = text(v(2));
    if (!sku) return;
    const io = text(v(3));
    const date = isoDate(v(4));
    const qty = num(v(5));
    if ((io !== "In" && io !== "Out") || !date || qty === null || qty <= 0) {
      badRows.push(`row ${n}: ${sku} ${io} ${text(v(4))} ${text(v(5))}`);
      return;
    }
    ledger.push({
      row: n,
      sku,
      io,
      date,
      qty,
      department: text(v(6)),
      remark: text(v(7)),
      jobName: text(v(8)),
    });
  });

  return { codes, items, skipped, grns, images, ledger, badRows };
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

const SOURCE = "Imported from IMS sheet";
const SKU_RE = /^([A-Z0-9]+)-([A-Z0-9]+)-\d+$/i;

async function main() {
  const { codes, items, skipped, grns, images, ledger, badRows } = await readSheet(file!);
  const replay = replayLedger(ledger);

  console.log(
    `Read ${items.length} materials (${skipped.length} skipped), ${grns.length} GRNs, ${images.size} photos, ${ledger.length} ledger rows (${badRows.length} unreadable).`,
  );
  for (const s of skipped) console.log(`  skip: ${s}`);
  for (const s of badRows) console.log(`  unreadable: ${s}`);
  console.log(
    `Replay: ${replay.batches.length} batches, ${replay.issues.length} issues, ${replay.adjustments.length} adjustments, ${replay.shortfalls} shortfall batches.`,
  );
  const unpaid = [...replay.unpaidShortfall].filter(([, q]) => q > 0);
  if (unpaid.length > 0) {
    console.log(`  ${unpaid.length} SKUs end below zero in the ledger; the app will show 0 where the sheet shows negative:`, unpaid.map(([s, q]) => `${s} (−${q})`).join(", "));
  }

  // Categories: the code is what the SKUs start with; the config only for
  // categories no item uses yet.
  const seen = new Map<string, Map<string, number>>();
  for (const it of items) {
    const m = SKU_RE.exec(it.sku);
    if (!m) continue;
    const per = seen.get(it.category) ?? new Map<string, number>();
    per.set(m[1]!.toUpperCase(), (per.get(m[1]!.toUpperCase()) ?? 0) + 1);
    seen.set(it.category, per);
  }
  const categoryCodes = new Map<string, string>();
  for (const [name, per] of seen) categoryCodes.set(name, [...per].sort((a, b) => b[1] - a[1])[0]![0]);
  for (const [name, code] of codes) if (!categoryCodes.has(name)) categoryCodes.set(name, code);
  {
    const used = new Map<string, string>();
    for (const [name, code] of categoryCodes) {
      if (used.has(code)) throw new Error(`Category code ${code} is used by both ${used.get(code)} and ${name}.`);
      used.set(code, name);
    }
  }
  const typeCodes = new Map<string, string>();
  for (const it of items) {
    const m = SKU_RE.exec(it.sku);
    if (m && !typeCodes.has(m[2]!.toUpperCase())) typeCodes.set(m[2]!.toUpperCase(), it.materialName);
  }

  const ledgerSkus = new Set(ledger.map((r) => r.sku));
  const orphanSkus = [...ledgerSkus].filter((s) => !items.some((i) => i.sku === s));

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    console.log("Methods:", ["On demand", "Consumption", "Interval"].map((m) => `${m}=${items.filter((i) => i.method === m).length}`).join(", "));
    console.log(`Ledger SKUs: ${ledgerSkus.size}; not in Item List: ${orphanSkus.join(", ") || "none"}`);
    const withJob = replay.batches.filter((b) => b.jobRef).length;
    const warned = replay.issues.filter((i) => i.warning).length;
    const grnLinked = replay.batches.filter((b) => b.grnNo).length;
    console.log(`Batches with a job: ${withJob}; GRN-linked: ${grnLinked}; issues taken from another job's paper: ${warned}.`);
    process.exit(0);
  }

  const { db }: DbModule = await import("../src/db");
  const { SYSTEM_ACTOR, auditedInsert, auditedUpdate }: AuditModule = await import("../src/db/audit");
  const schema: SchemaModule = await import("../src/db/schema");
  const { eq, isNull, and, sql, inArray, like, or } = await import("drizzle-orm");

  const counts = {
    categories: 0, types: 0, materialsCreated: 0, materialsUpdated: 0, grns: 0,
    retiredBatches: 0, retiredIssues: 0, retiredAdjustments: 0, humanIssuesRetired: 0,
    batches: 0, issues: 0, adjustments: 0,
  };

  await db.transaction(async (tx) => {
    /* ---- 1. Retire what an earlier import wrote ---------------------------- */
    const earlier = await tx
      .select({ id: schema.materialBatch.id, batchNo: schema.materialBatch.batchNo })
      .from(schema.materialBatch)
      .where(
        and(
          isNull(schema.materialBatch.deletedAt),
          or(
            like(schema.materialBatch.batchNo, "IO-%"),
            like(schema.materialBatch.remarks, `%${SOURCE}%`),
          ),
        ),
      );
    if (earlier.length > 0) {
      const ids = earlier.map((b) => b.id);
      const issuesOn = await tx
        .select({ id: schema.materialIssue.id, no: schema.materialIssue.issueNo, by: schema.materialIssue.createdBy })
        .from(schema.materialIssue)
        .where(and(inArray(schema.materialIssue.batchId, ids), isNull(schema.materialIssue.deletedAt)));
      const adjOn = await tx
        .select({ id: schema.materialAdjustment.id })
        .from(schema.materialAdjustment)
        .where(and(inArray(schema.materialAdjustment.batchId, ids), isNull(schema.materialAdjustment.deletedAt)));

      const human = issuesOn.filter((i) => i.by !== SYSTEM_ACTOR.id && !i.no.startsWith("MI-IO-"));
      for (const h of human) console.log(`  retiring an issue a person entered against an imported batch: ${h.no}`);
      counts.humanIssuesRetired = human.length;

      const now = new Date();
      // Soft delete, direct: these are the importer's own rows being replaced,
      // and one audit row per replaced batch would be thousands of entries
      // that say the same thing. One summary line is written below instead.
      if (issuesOn.length > 0) await tx.update(schema.materialIssue).set({ deletedAt: now, updatedBy: SYSTEM_ACTOR.id }).where(inArray(schema.materialIssue.id, issuesOn.map((i) => i.id)));
      if (adjOn.length > 0) await tx.update(schema.materialAdjustment).set({ deletedAt: now, updatedBy: SYSTEM_ACTOR.id }).where(inArray(schema.materialAdjustment.id, adjOn.map((a) => a.id)));
      await tx.update(schema.materialBatch).set({ deletedAt: now, updatedBy: SYSTEM_ACTOR.id }).where(inArray(schema.materialBatch.id, ids));
      counts.retiredBatches = ids.length;
      counts.retiredIssues = issuesOn.length;
      counts.retiredAdjustments = adjOn.length;
      await tx.execute(sql`insert into audit_log (table_name, record_id, action, changed_by, before, after)
        values ('material_batch', ${SYSTEM_ACTOR.id}, 'SOFT_DELETE', ${SYSTEM_ACTOR.id},
                ${JSON.stringify({ retired_batches: ids.length, issues: issuesOn.length, adjustments: adjOn.length })}::jsonb,
                ${JSON.stringify({ reason: "Replaced by a fresh replay of the IMS ledger (section P)" })}::jsonb)`);
    }

    /* ---- 2. Vocabularies ---------------------------------------------------- */
    const catId = new Map<string, string>();
    let seq = 0;
    for (const [name, code] of categoryCodes) {
      seq += 10;
      const [existing] = await tx.select({ id: schema.materialCategory.id }).from(schema.materialCategory)
        .where(and(eq(schema.materialCategory.code, code), isNull(schema.materialCategory.deletedAt))).limit(1);
      if (existing) { catId.set(name, existing.id); continue; }
      const row = await auditedInsert(SYSTEM_ACTOR, schema.materialCategory, { code, name, sequence: seq }, tx);
      catId.set(name, row.id);
      counts.categories++;
    }
    const typeId = new Map<string, string>();
    seq = 0;
    for (const [code, name] of typeCodes) {
      seq += 10;
      const [existing] = await tx.select({ id: schema.materialType.id }).from(schema.materialType)
        .where(and(eq(schema.materialType.code, code), isNull(schema.materialType.deletedAt))).limit(1);
      if (existing) { typeId.set(code, existing.id); continue; }
      const row = await auditedInsert(SYSTEM_ACTOR, schema.materialType, { code, name, sequence: seq }, tx);
      typeId.set(code, row.id);
      counts.types++;
    }

    /* ---- 3. Materials: create or bring the reorder figures up to date ------ */
    const materialId = new Map<string, string>();
    const unitOf = new Map<string, string>();
    for (const it of items) {
      const m = SKU_RE.exec(it.sku);
      if (!m) continue;
      unitOf.set(it.sku, it.unit);
      const reorder = {
        reorderMethod: it.method,
        leadTimeDays: it.leadTime,
        minOrderQty: money2(it.moq),
        safetyFactor: money2(it.factor),
        issueIntervalDays: dec1(it.interval),
        inTransitQty: money2(it.inTransit),
        imageUrl: images.get(it.sku) ?? null,
        isActive: it.active,
      };
      const [existing] = await tx.select({ id: schema.material.id }).from(schema.material)
        .where(and(eq(schema.material.sku, it.sku), isNull(schema.material.deletedAt))).limit(1);
      if (existing) {
        await auditedUpdate(SYSTEM_ACTOR, schema.material, existing.id, reorder, tx);
        materialId.set(it.sku, existing.id);
        counts.materialsUpdated++;
        continue;
      }
      const row = await auditedInsert(SYSTEM_ACTOR, schema.material, {
        sku: it.sku, name: it.name, categoryId: catId.get(it.category)!, typeId: typeId.get(m[2]!.toUpperCase())!,
        size: it.size, gsm: it.gsm, colour: it.colour, finish: it.finish, unit: it.unit as "Sheet",
        ...reorder, remarks: `${SOURCE} 19 Sep 2026`,
      }, tx);
      materialId.set(it.sku, row.id);
      counts.materialsCreated++;
    }

    // A ledger SKU with no Item List row: made from the ledger's own name
    // column is not available here (the ledger stores only the SKU), so it
    // is reported and its rows are skipped. None exist in the 19 Sep file.
    for (const sku of orphanSkus) console.log(`  skip ledger SKU ${sku}: no Item List row`);

    /* ---- 4. GRNs -------------------------------------------------------------- */
    const grnId = new Map<string, string>();
    for (const g of grns) {
      const [existing] = await tx.select({ id: schema.grn.id }).from(schema.grn)
        .where(and(eq(schema.grn.grnNo, g.grnNo), isNull(schema.grn.deletedAt))).limit(1);
      if (existing) { grnId.set(g.grnNo, existing.id); continue; }
      const row = await auditedInsert(SYSTEM_ACTOR, schema.grn, {
        grnNo: g.grnNo, receivedDate: g.date, vendor: g.vendor, invoiceNo: g.invoiceNo,
        invoiceUrl: g.invoiceUrl && /^https?:\/\//i.test(g.invoiceUrl) ? g.invoiceUrl : null,
        remarks: [g.remark, SOURCE].filter(Boolean).join(" · "),
      }, tx);
      grnId.set(g.grnNo, row.id);
      counts.grns++;
    }

    /* ---- 5. The ledger, replayed ---------------------------------------------- */
    // Direct inserts inside the transaction, attributed to SYSTEM. Auditing
    // ~4,000 historical rows one by one would double the load time and fill
    // the audit log with January; the summary row below records the load.
    const batchId = new Map<string, string>();
    for (const b of replay.batches) {
      const mId = materialId.get(b.sku);
      if (!mId) continue;
      const kindNote = b.kind === "correction" ? "Count correction (ledger)" : b.kind === "shortfall" ? "Shortfall (ledger)" : null;
      const [row] = await tx.insert(schema.materialBatch).values({
        batchNo: b.batchNo,
        grnId: b.grnNo ? (grnId.get(b.grnNo) ?? null) : null,
        materialId: mId,
        receivedDate: b.date,
        qtyReceived: money2(b.qty)!,
        jobRef: b.jobRef,
        remarks: [kindNote, b.department ? `To ${b.department}` : null, b.remark, `${SOURCE} row ${b.row}`].filter(Boolean).join(" · "),
        createdBy: SYSTEM_ACTOR.id,
        updatedBy: SYSTEM_ACTOR.id,
      }).returning({ id: schema.materialBatch.id });
      batchId.set(b.batchNo, row!.id);
      counts.batches++;
    }
    // Issues go through the same guard as a typed one — the replay already
    // guarantees a batch is never overdrawn, and the trigger checks it.
    for (const i of replay.issues) {
      const bId = batchId.get(i.batchNo);
      if (!bId) continue;
      await tx.insert(schema.materialIssue).values({
        issueNo: i.issueNo,
        batchId: bId,
        issuedOn: i.date,
        qty: money2(i.qty)!,
        department: i.department,
        jobRef: i.jobRef,
        remarks: [i.warning, i.remark, `${SOURCE} row ${i.row}`].filter(Boolean).join(" · "),
        createdBy: SYSTEM_ACTOR.id,
        updatedBy: SYSTEM_ACTOR.id,
      });
      counts.issues++;
    }
    for (const a of replay.adjustments) {
      const bId = batchId.get(a.batchNo);
      if (!bId) continue;
      await tx.insert(schema.materialAdjustment).values({
        adjustmentNo: a.adjustmentNo,
        batchId: bId,
        adjustedOn: a.date,
        qty: money2(a.qty)!,
        reason: "Count correction",
        remarks: [a.remark, `${SOURCE} row ${a.row}`].filter(Boolean).join(" · "),
        createdBy: SYSTEM_ACTOR.id,
        updatedBy: SYSTEM_ACTOR.id,
      });
      counts.adjustments++;
    }
    await tx.execute(sql`insert into audit_log (table_name, record_id, action, changed_by, before, after)
      values ('material_batch', ${SYSTEM_ACTOR.id}, 'INSERT', ${SYSTEM_ACTOR.id}, null,
              ${JSON.stringify({ source: `${SOURCE} ${file}`, batches: counts.batches, issues: counts.issues, adjustments: counts.adjustments })}::jsonb)`);

    /* ---- 6. The check: the view must agree with the ledger, every SKU -------- */
    const mismatches: string[] = [];
    for (const [sku, expected] of replay.closing) {
      if (!materialId.has(sku)) continue;
      const want = Math.max(0, expected); // the ledger can end negative; stock cannot
      const [r] = (await tx.execute(sql`select closing_stock from v_material_stock where sku = ${sku}`)).rows as { closing_stock: string }[];
      if (!r || Math.abs(Number(r.closing_stock) - want) > 0.001) {
        mismatches.push(`${sku}: ledger ${expected}, view ${r?.closing_stock ?? "missing"}`);
      }
    }
    if (mismatches.length > 0) {
      console.error("Closing stock does not match the ledger — rolling back:\n  " + mismatches.slice(0, 20).join("\n  ") + (mismatches.length > 20 ? `\n  … ${mismatches.length - 20} more` : ""));
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
