import { beforeEach, describe, expect, it } from "vitest";

import {
  isCorrection,
  jobRefFor,
  normaliseDepartment,
  replayLedger,
  type LedgerRow,
} from "@/modules/materials/ledger";

/**
 * Replaying the sheet's ledger (P1, P3). The rules the store will argue
 * about — whose paper an issue came from, what a correction is, what happens
 * when the ledger dips below zero — settled here rather than on a screen.
 */

let n = 0;
beforeEach(() => {
  n = 0;
});
const row = (over: Partial<LedgerRow>): LedgerRow => ({
  row: (n += 1),
  sku: "P-SBS-001",
  io: "In",
  date: "2026-03-01",
  qty: 100,
  department: "Store",
  remark: null,
  jobName: null,
  ...over,
});

describe("classifying a ledger row", () => {
  it("recognises the ways the store wrote 'correction'", () => {
    for (const r of ["adj", "ADJ", "Adjustment", "out-adjustment", "CORECTION", "Stock Count Correction: 0 → 25", "stock adjustment"]) {
      expect(isCorrection(r)).toBe(true);
    }
    expect(isCorrection("Nicobar")).toBe(false);
    expect(isCorrection("GRN GRN-260911-104302 / Inv OK26/4180")).toBe(false);
    expect(isCorrection(null)).toBe(false);
  });

  it("fixes the case and spacing of departments without merging names", () => {
    expect(normaliseDepartment("cutting ")).toBe("Cutting");
    expect(normaliseDepartment("CUTTING")).toBe("Cutting");
    expect(normaliseDepartment("Paper Cutting")).toBe("Paper Cutting");
    expect(normaliseDepartment("6/c")).toBe("6/C");
    expect(normaliseDepartment("STORE / PURCHASE")).toBe("Store / Purchase");
    expect(normaliseDepartment("Store / Purchase")).toBe("Store / Purchase");
    expect(normaliseDepartment("  ")).toBeNull();
  });

  it("reads the job from the Job Name column, else from a cutting receipt's remark", () => {
    expect(jobRefFor(row({ jobName: "KOOK HERBAL" }))).toBe("KOOK HERBAL");
    expect(jobRefFor(row({ department: "Cutting", remark: "Nicobar" }))).toBe("Nicobar");
    expect(jobRefFor(row({ department: "Store", remark: "Nicobar" }))).toBeNull();
    expect(jobRefFor(row({ department: "Cutting", remark: "adj" }))).toBeNull();
    expect(jobRefFor(row({ department: "Cutting", remark: "GRN GRN-260911-104302" }))).toBeNull();
    expect(jobRefFor(row({ io: "Out", department: "Cutting", remark: "Nicobar" }))).toBeNull();
  });
});

describe("replaying the ledger", () => {
  it("your varnish: 25 corrected in, 25 out, 20 received → 20 left, in two batches", () => {
    const r = replayLedger([
      row({ sku: "CH-VAR-134", date: "2026-09-02", qty: 25, remark: "Stock Count Correction: 0 → 25" }),
      row({ sku: "CH-VAR-134", io: "Out", date: "2026-09-08", qty: 25, department: "Offset Printing" }),
      row({ sku: "CH-VAR-134", date: "2026-09-10", qty: 20, remark: "GRN GRN-260911-104302 / Inv OK26/4180" }),
    ]);
    expect(r.closing.get("CH-VAR-134")).toBe(20);
    expect(r.batches.map((b) => [b.kind, b.qty, b.grnNo])).toEqual([
      ["correction", 25, null],
      ["receipt", 20, "GRN-260911-104302"],
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.batchNo).toBe(r.batches[0]!.batchNo);
    expect(r.shortfalls).toBe(0);
  });

  it("takes oldest first and splits an issue across batches", () => {
    const r = replayLedger([
      row({ date: "2026-03-01", qty: 100 }),
      row({ date: "2026-03-05", qty: 100 }),
      row({ io: "Out", date: "2026-03-10", qty: 150 }),
    ]);
    expect(r.issues.map((i) => [i.batchNo, i.qty])).toEqual([
      ["IO-1", 100],
      ["IO-2", 50],
    ]);
    expect(r.issues.map((i) => i.issueNo)).toEqual(["MI-IO-3", "MI-IO-3-b"]);
  });

  it("prefers the job's own reserved paper, then general stock, then warns", () => {
    const r = replayLedger([
      row({ date: "2026-03-01", qty: 100, department: "Cutting", remark: "Nicobar" }),
      row({ date: "2026-03-02", qty: 100 }),
      row({ date: "2026-03-03", qty: 100, department: "Cutting", remark: "Sky Valve" }),
      row({ io: "Out", date: "2026-03-10", qty: 250, jobName: "sky valve" }),
    ]);
    expect(r.issues.map((i) => [i.qty, i.warning])).toEqual([
      [100, null], // Sky Valve's own (case-insensitive)
      [100, null], // general
      [50, '50 taken from paper reserved for job "Nicobar" for job "sky valve".'],
    ]);
  });

  it("creates a shortfall batch when the ledger dips below zero, and the closing figure still holds", () => {
    const r = replayLedger([
      row({ sku: "M-DHO-165", io: "Out", date: "2026-02-05", qty: 10 }),
      row({ sku: "M-DHO-165", date: "2026-02-20", qty: 50 }),
      row({ sku: "M-DHO-165", io: "Out", date: "2026-02-21", qty: 5 }),
    ]);
    expect(r.shortfalls).toBe(1);
    expect(r.batches[0]!.kind).toBe("shortfall");
    expect(r.batches[0]!.qty).toBe(10);
    expect(r.closing.get("M-DHO-165")).toBe(35);
    // The next receipt pays the shortfall back, so batch arithmetic agrees
    // with the ledger: 10 + 50 received, 15 issued, 10 adjusted away.
    expect(r.adjustments).toEqual([
      expect.objectContaining({ adjustmentNo: "MA-IO-2-SHORT", batchNo: "IO-2", qty: -10 }),
    ]);
    const received = r.batches.reduce((s, b) => s + b.qty, 0);
    const issued = r.issues.reduce((s, i) => s + i.qty, 0);
    const adjusted = r.adjustments.reduce((s, a) => s + a.qty, 0);
    expect(received - issued + adjusted).toBe(35);
    expect(r.unpaidShortfall.get("M-DHO-165")).toBe(0);
  });

  it("turns an Out marked as a correction into negative adjustments, not issues", () => {
    const r = replayLedger([
      row({ date: "2026-03-01", qty: 20 }),
      row({ io: "Out", date: "2026-03-02", qty: 4, remark: "Adjustment (Count Correction): OPEN-I-CMY-064" }),
    ]);
    expect(r.issues).toHaveLength(0);
    expect(r.adjustments).toEqual([
      expect.objectContaining({ adjustmentNo: "MA-IO-2", qty: -4 }),
    ]);
    expect(r.closing.get("P-SBS-001")).toBe(16);
  });

  it("orders by date, then by row, whatever order the rows arrive in", () => {
    const r = replayLedger([
      row({ io: "Out", date: "2026-03-05", qty: 30 }),
      row({ date: "2026-03-01", qty: 100 }),
    ]);
    expect(r.shortfalls).toBe(0);
    expect(r.issues[0]!.qty).toBe(30);
  });
});
