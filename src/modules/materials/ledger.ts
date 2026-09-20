/**
 * Replaying the store's ledger into batches, issues and adjustments (P1).
 *
 * The sheet's `InOut (Manual)` tab is one row per movement: a SKU, In or Out,
 * a date, a quantity, a department, a remark and sometimes a job name. Its
 * running sum is the stock the factory trusts. This module turns those rows
 * into the batch-level shape the store keeps — pure, so the rules can be
 * tested without a workbook or a database:
 *
 *   In                → a batch. A remark naming a GRN links it; a job name
 *                       (or, before August, the remark itself on a cutting
 *                       receipt) becomes the batch's job reference (P3).
 *   Out               → issues, taken from the job's own reserved batches
 *                       first, then oldest-first from the rest (P3).
 *   "adjust"/"correction" rows → count corrections: an In becomes a batch
 *                       marked as such; an Out becomes negative adjustments.
 *   Out with nothing to take from → a shortfall batch is created at that
 *                       point and drawn on, and says so. The ledger predates
 *                       the stock; 32 such moments exist in the real file.
 *                       The ledger's running sum absorbs such a dip into the
 *                       next receipt, and so does this: the next In carries a
 *                       negative adjustment for the amount owed, so closing
 *                       stock agrees with the sheet to the unit.
 *
 * Numbers are derived from the ledger row, so a re-run of the same file
 * produces the same identifiers and the importer can skip what exists.
 */

export type LedgerRow = {
  /** The row number in the sheet — the stable identity of the movement. */
  row: number;
  sku: string;
  io: "In" | "Out";
  /** yyyy-mm-dd */
  date: string;
  qty: number;
  department: string | null;
  remark: string | null;
  jobName: string | null;
};

export type ReplayBatch = {
  batchNo: string;
  row: number;
  sku: string;
  date: string;
  qty: number;
  grnNo: string | null;
  jobRef: string | null;
  department: string | null;
  kind: "receipt" | "correction" | "shortfall";
  remark: string | null;
};

export type ReplayIssue = {
  issueNo: string;
  row: number;
  batchNo: string;
  date: string;
  qty: number;
  department: string | null;
  jobRef: string | null;
  remark: string | null;
  /** Set when the paper came from another job's reservation (P3). */
  warning: string | null;
};

export type ReplayAdjustment = {
  adjustmentNo: string;
  row: number;
  batchNo: string;
  date: string;
  /** Negative: a count correction downwards. */
  qty: number;
  remark: string | null;
};

export type Replay = {
  batches: ReplayBatch[];
  issues: ReplayIssue[];
  adjustments: ReplayAdjustment[];
  /** Per SKU, what the ledger says is left — what the database must agree with. */
  closing: Map<string, number>;
  shortfalls: number;
  /** SKUs whose ledger ENDS below what was received — closing in the app will exceed the sheet's by this much. */
  unpaidShortfall: Map<string, number>;
};

const CORRECTION = /adjust|\badj\b|corr?ection|stock count/i;
const GRN_IN_REMARK = /\b(GRN-\d{6}-\d{6})\b/;
const CUTTING = /cutting/i;

export const isCorrection = (remark: string | null | undefined): boolean =>
  Boolean(remark && CORRECTION.test(remark));

export const grnInRemark = (remark: string | null | undefined): string | null =>
  remark ? (GRN_IN_REMARK.exec(remark)?.[1] ?? null) : null;

/**
 * "6/c", "cutting ", "STORE / PURCHASE" → "6/C", "Cutting", "Store / Purchase".
 * The ledger's departments are one vocabulary typed thirty ways; this only
 * fixes case and spacing, and never merges two different names.
 */
export function normaliseDepartment(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s === "") return null;
  if (/^\d+\/[a-z]$/i.test(s)) return s.toUpperCase();
  const isShouting = s === s.toUpperCase() || s === s.toLowerCase();
  if (!isShouting) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-z])/g, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

/**
 * The job a receipt was for. After August the ledger has a Job Name column;
 * before, the store wrote the job in the remark of paper received "into
 * Cutting". A remark that is a GRN reference or a correction is not a job.
 */
export function jobRefFor(row: LedgerRow): string | null {
  const name = row.jobName?.trim();
  if (name) return name;
  if (row.io !== "In") return null;
  if (!row.department || !CUTTING.test(row.department)) return null;
  const remark = row.remark?.trim();
  if (!remark || isCorrection(remark) || grnInRemark(remark)) return null;
  return remark;
}

const sameJob = (a: string | null, b: string | null) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

function byLedgerOrder(a: LedgerRow, b: LedgerRow): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row;
}

export function replayLedger(rows: LedgerRow[]): Replay {
  const batches: ReplayBatch[] = [];
  const issues: ReplayIssue[] = [];
  const adjustments: ReplayAdjustment[] = [];
  const closing = new Map<string, number>();
  let shortfalls = 0;

  // Open stock per SKU, in receipt order: what each batch still holds.
  const open = new Map<string, { batch: ReplayBatch; left: number }[]>();
  // What a shortfall batch lent, per SKU, still to be taken back from a receipt.
  const debt = new Map<string, number>();
  const openFor = (sku: string) => {
    let list = open.get(sku);
    if (!list) open.set(sku, (list = []));
    return list;
  };

  const suffix = (i: number) => (i === 0 ? "" : `-${String.fromCharCode(97 + i)}`);

  /**
   * Takes `qty` for `row` from the SKU's open batches, the job's own first,
   * then oldest first, creating a shortfall batch for whatever is not there.
   * Returns the pieces, one per batch drawn on.
   */
  const draw = (row: LedgerRow, qty: number, jobRef: string | null) => {
    const list = openFor(row.sku);
    const pieces: { batch: ReplayBatch; qty: number; fromOtherJob: string | null }[] = [];
    let need = qty;

    const take = (entry: { batch: ReplayBatch; left: number }, fromOtherJob: string | null) => {
      if (need <= 0 || entry.left <= 0) return;
      const q = Math.min(entry.left, need);
      entry.left -= q;
      need -= q;
      pieces.push({ batch: entry.batch, qty: q, fromOtherJob });
    };

    // 1. The job's own paper.
    if (jobRef) for (const e of list) if (sameJob(e.batch.jobRef, jobRef)) take(e, null);
    // 2. Unreserved stock, oldest first.
    for (const e of list) if (!e.batch.jobRef) take(e, null);
    // 3. Another job's paper — allowed, and said so (the sheet's ⚠️ Warning).
    for (const e of list) if (e.batch.jobRef && !sameJob(e.batch.jobRef, jobRef)) take(e, e.batch.jobRef);

    if (need > 0) {
      shortfalls += 1;
      const short: ReplayBatch = {
        batchNo: `IO-${row.row}-SHORT`,
        row: row.row,
        sku: row.sku,
        date: row.date,
        qty: need,
        grnNo: null,
        jobRef: null,
        department: null,
        kind: "shortfall",
        remark: `Ledger went below zero here: ${need} more was issued than the ledger had received by this date. Stock existed before the ledger began; this batch stands in for it.`,
      };
      batches.push(short);
      list.push({ batch: short, left: 0 });
      pieces.push({ batch: short, qty: need, fromOtherJob: null });
      debt.set(row.sku, (debt.get(row.sku) ?? 0) + need);
      need = 0;
    }
    return pieces;
  };

  for (const row of [...rows].sort(byLedgerOrder)) {
    if (!(row.qty > 0)) continue;
    const correction = isCorrection(row.remark);
    const department = normaliseDepartment(row.department);
    closing.set(row.sku, (closing.get(row.sku) ?? 0) + (row.io === "In" ? row.qty : -row.qty));

    if (row.io === "In") {
      const batch: ReplayBatch = {
        batchNo: `IO-${row.row}`,
        row: row.row,
        sku: row.sku,
        date: row.date,
        qty: row.qty,
        grnNo: grnInRemark(row.remark),
        jobRef: correction ? null : jobRefFor(row),
        department,
        kind: correction ? "correction" : "receipt",
        remark: row.remark?.trim() || null,
      };
      batches.push(batch);
      const entry = { batch, left: row.qty };
      openFor(row.sku).push(entry);

      // Pay back what a shortfall batch lent, the way the ledger's running
      // sum does when a receipt follows a dip below zero.
      const owed = debt.get(row.sku) ?? 0;
      if (owed > 0) {
        const repay = Math.min(owed, row.qty);
        entry.left -= repay;
        debt.set(row.sku, owed - repay);
        adjustments.push({
          adjustmentNo: `MA-IO-${row.row}-SHORT`,
          row: row.row,
          batchNo: batch.batchNo,
          date: row.date,
          qty: -repay,
          remark: `Covers ${repay} issued before the ledger had received it (a shortfall batch stood in). Net effect nil; the ledger's closing figure holds.`,
        });
      }
      continue;
    }

    const jobRef = row.jobName?.trim() || null;
    const pieces = draw(row, row.qty, jobRef);
    pieces.forEach((p, i) => {
      if (correction) {
        adjustments.push({
          adjustmentNo: `MA-IO-${row.row}${suffix(i)}`,
          row: row.row,
          batchNo: p.batch.batchNo,
          date: row.date,
          qty: -p.qty,
          remark: row.remark?.trim() || null,
        });
      } else {
        issues.push({
          issueNo: `MI-IO-${row.row}${suffix(i)}`,
          row: row.row,
          batchNo: p.batch.batchNo,
          date: row.date,
          qty: p.qty,
          department,
          jobRef,
          remark: row.remark?.trim() || null,
          warning: p.fromOtherJob
            ? `${p.qty} taken from paper reserved for job "${p.fromOtherJob}"${jobRef ? ` for job "${jobRef}"` : ""}.`
            : null,
        });
      }
    });
  }

  return { batches, issues, adjustments, closing, shortfalls, unpaidShortfall: debt };
}
