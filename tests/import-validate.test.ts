import { describe, expect, it } from "vitest";

import {
  dedupeKey,
  importableRows,
  parseDate,
  validateRows,
  type ClientLookup,
  type RawRow,
} from "@/modules/imports/validate";

/**
 * The importer's validation, tested as a pure function.
 *
 * No database, no spreadsheet, no session. These rules are the entire safety of
 * the feature — the requirement is that somebody sees exactly what will happen
 * before anything is written — so they are worth testing directly rather than
 * through an upload.
 */

const NAT: ClientLookup = { id: "11111111-1111-1111-1111-111111111111", code: "NAT", name: "Nature Packaging Pvt Ltd" };
const MUL: ClientLookup = { id: "22222222-2222-2222-2222-222222222222", code: "MUL", name: "Multipack Industries" };

const CLIENTS = [NAT, MUL];

const row = (over: Partial<RawRow> = {}): RawRow => ({
  rowNumber: 2,
  clientName: "Nature Packaging Pvt Ltd",
  poNo: "4500123456",
  poDate: "05/04/2026",
  itemName: "250ml carton — outer",
  orderedQty: "1000",
  rate: "12.50",
  committedDate: "20/04/2026",
  dispatchDate: "18/04/2026",
  dispatchedQty: "1000",
  challanNo: "CH-99",
  ...over,
});

const validate = (rows: RawRow[], existing: string[] = []) =>
  validateRows(rows, { clients: CLIENTS, existingKeys: new Set(existing) });

describe("parseDate", () => {
  it("reads DD/MM/YYYY, day first", () => {
    // Not cosmetic: 03/04/2026 is a different day under each convention and
    // both parse silently. Guessing puts a job three weeks out.
    expect(parseDate("03/04/2026")).toEqual({ ok: true, iso: "2026-04-03" });
    expect(parseDate("3-4-2026")).toEqual({ ok: true, iso: "2026-04-03" });
    expect(parseDate("31/12/2026")).toEqual({ ok: true, iso: "2026-12-31" });
  });

  it("accepts an ISO date, which is what a real date cell normalises to", () => {
    expect(parseDate("2026-04-03")).toEqual({ ok: true, iso: "2026-04-03" });
  });

  it("rejects a day that does not exist", () => {
    // Passes the shape check and is not a day.
    expect(parseDate("31/02/2026").ok).toBe(false);
    expect(parseDate("00/04/2026").ok).toBe(false);
  });

  it("rejects anything it cannot read rather than guessing", () => {
    expect(parseDate("April 3").ok).toBe(false);
    expect(parseDate("").ok).toBe(false);
    expect(parseDate("2026").ok).toBe(false);
  });
});

describe("validateRows — clients", () => {
  it("matches a client by name, ignoring case and spacing", () => {
    const result = validate([row({ clientName: "  nature   packaging PVT ltd " })]);
    expect(result.rows[0]!.status).toBe("ok");
    expect(result.rows[0]!.parsed!.clientId).toBe(NAT.id);
  });

  it("matches a client by code, because that is what is on the paper", () => {
    const result = validate([row({ clientName: "MUL" })]);
    expect(result.rows[0]!.parsed!.clientId).toBe(MUL.id);
  });

  it("REFUSES an unknown client instead of creating one", () => {
    // Auto-creating is how "Nature Packaging", "Nature packaging Pvt Ltd" and
    // "NAure Packaging" become three customers nobody notices.
    const result = validate([row({ clientName: "Nture Packging" })]);

    expect(result.rows[0]!.status).toBe("error");
    expect(result.rows[0]!.reasons[0]).toContain("never creates clients");
    expect(result.summary.unknownClients).toEqual(["Nture Packging"]);
  });
});

describe("validateRows — errors block one row only", () => {
  it("imports the good rows from a file with bad ones", () => {
    const result = validate([
      row({ rowNumber: 2 }),
      row({ rowNumber: 3, poDate: "not a date", poNo: "PO-3" }),
      row({ rowNumber: 4, poNo: "PO-4" }),
      row({ rowNumber: 5, orderedQty: "abc", poNo: "PO-5" }),
    ]);

    expect(result.summary.total).toBe(4);
    expect(result.summary.error).toBe(2);
    expect(importableRows(result).map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it("reports every problem on a row, not just the first", () => {
    const result = validate([
      row({ poDate: "nope", orderedQty: "-5", clientName: "Who?" }),
    ]);
    expect(result.rows[0]!.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a dispatched quantity larger than the order", () => {
    const result = validate([row({ orderedQty: "500", dispatchedQty: "600" })]);
    expect(result.rows[0]!.status).toBe("error");
    expect(result.rows[0]!.reasons.join(" ")).toContain("more than the 500 ordered");
  });

  it("refuses a blank PO number, which the dedupe key depends on", () => {
    const result = validate([row({ poNo: "  " })]);
    expect(result.rows[0]!.status).toBe("error");
    expect(result.rows[0]!.reasons.join(" ")).toContain("re-run duplicating");
  });

  it("requires a dispatch date once anything was dispatched", () => {
    const result = validate([row({ dispatchedQty: "400", dispatchDate: "" })]);
    expect(result.rows[0]!.status).toBe("error");
  });

  it("accepts a job that has not been dispatched at all", () => {
    const result = validate([row({ dispatchedQty: "", dispatchDate: "", challanNo: "" })]);
    expect(result.rows[0]!.status).toBe("ok");
    expect(result.rows[0]!.parsed!.dispatchedQty).toBe(0);
    expect(result.rows[0]!.parsed!.challanKey).toBeNull();
  });
});

describe("validateRows — committed date (F8)", () => {
  it("allows a blank committed date and flags it", () => {
    const result = validate([row({ committedDate: "" })]);

    expect(result.rows[0]!.status).toBe("warning");
    expect(result.rows[0]!.parsed!.committedDate).toBeNull();
    expect(result.rows[0]!.reasons.join(" ")).toContain("excluded from OTD");
  });

  it("still refuses a committed date that is present but unreadable", () => {
    // Blank means "never recorded". Garbage means somebody typed something
    // wrong, and importing it as blank would hide that.
    const result = validate([row({ committedDate: "20th April" })]);
    expect(result.rows[0]!.status).toBe("error");
  });
});

describe("validateRows — duplicates", () => {
  it("warns and skips a row already in the database, never overwriting", () => {
    const existing = dedupeKey(NAT.id, "4500123456", "250ml carton — outer");
    const result = validate([row()], [existing]);

    expect(result.rows[0]!.status).toBe("warning");
    expect(result.rows[0]!.reasons[0]).toContain("skipped, not overwritten");
    expect(result.summary.duplicate).toBe(1);
    // And it is genuinely not written.
    expect(importableRows(result)).toHaveLength(0);
  });

  it("makes re-running the same file a no-op", () => {
    // Somebody will do this. It has to be safe.
    const first = validate([row({ rowNumber: 2 }), row({ rowNumber: 3, itemName: "Insert" })]);
    const keys = importableRows(first).map((r) =>
      dedupeKey(r.parsed!.clientId, r.parsed!.poNo, r.parsed!.itemName),
    );

    const second = validate([row({ rowNumber: 2 }), row({ rowNumber: 3, itemName: "Insert" })], keys);
    expect(importableRows(second)).toHaveLength(0);
    expect(second.summary.duplicate).toBe(2);
  });

  it("flags the same row appearing twice within one file", () => {
    const result = validate([row({ rowNumber: 2 }), row({ rowNumber: 3 })]);

    expect(result.rows[0]!.status).toBe("ok");
    expect(result.rows[1]!.status).toBe("warning");
    expect(result.rows[1]!.reasons.join(" ")).toContain("appear earlier in this file");
  });
});

describe("validateRows — grouping", () => {
  it("puts two items with the same client and PO number on ONE order", () => {
    const result = validate([
      row({ rowNumber: 2, itemName: "Outer carton" }),
      row({ rowNumber: 3, itemName: "Inner tray" }),
    ]);

    const [a, b] = result.rows;
    expect(a!.parsed!.poKey).toBe(b!.parsed!.poKey);
    // ...and they are still two separate items.
    expect(a!.parsed!.itemName).not.toBe(b!.parsed!.itemName);
  });

  it("puts two rows sharing a challan number on ONE dispatch", () => {
    const result = validate([
      row({ rowNumber: 2, itemName: "Outer carton", challanNo: "CH-77" }),
      row({ rowNumber: 3, itemName: "Inner tray", challanNo: "CH-77" }),
    ]);

    expect(result.rows[0]!.parsed!.challanKey).toBe(result.rows[1]!.parsed!.challanKey);
  });

  it("gives rows with no challan number their own dispatch each", () => {
    // Otherwise every un-numbered delivery in the file would merge into one
    // challan, which is not what happened.
    const result = validate([
      row({ rowNumber: 2, itemName: "Outer carton", challanNo: "" }),
      row({ rowNumber: 3, itemName: "Inner tray", challanNo: "" }),
    ]);

    expect(result.rows[0]!.parsed!.challanKey).not.toBe(result.rows[1]!.parsed!.challanKey);
  });

  it("does not merge the same challan number across different clients", () => {
    const result = validate([
      row({ rowNumber: 2, clientName: "NAT", challanNo: "1" }),
      row({ rowNumber: 3, clientName: "MUL", challanNo: "1", poNo: "MUL-1" }),
    ]);

    // The database refuses a mixed-client challan (C8); this stops the
    // importer building one in the first place.
    expect(result.rows[0]!.parsed!.challanKey).not.toBe(result.rows[1]!.parsed!.challanKey);
  });
});

describe("validateRows — summary", () => {
  it("counts what the preview screen shows", () => {
    const existing = dedupeKey(NAT.id, "DUP-1", "Dup item");
    const result = validate(
      [
        row({ rowNumber: 2, poNo: "A-1" }),
        row({ rowNumber: 3, poNo: "A-2", committedDate: "" }),
        row({ rowNumber: 4, poNo: "A-3", poDate: "rubbish" }),
        row({ rowNumber: 5, poNo: "DUP-1", itemName: "Dup item" }),
      ],
      [existing],
    );

    expect(result.summary).toMatchObject({
      total: 4,
      ok: 1,
      warning: 2,
      error: 1,
      duplicate: 1,
    });
  });
});
