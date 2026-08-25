import { describe, expect, it } from "vitest";

import {
  clientsToCreate,
  dedupeKey,
  importableRows,
  parseDate,
  validateRows,
  CREATE_NEW,
  type ClientDecisions,
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

const validate = (rows: RawRow[], existing: string[] = [], decisions: ClientDecisions = {}) =>
  validateRows(rows, { clients: CLIENTS, existingKeys: new Set(existing), decisions });

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

  it("matches a name that differs only by a legal suffix", () => {
    // The requirement's own example, at the level the importer actually runs.
    const result = validate([row({ clientName: "NATURE PACKAGING PVT. LTD." })]);

    expect(result.rows[0]!.status).toBe("ok");
    expect(result.rows[0]!.parsed!.clientId).toBe(NAT.id);
    expect(result.summary.clients).toMatchObject({ matched: 1, toCreate: 0, needsReview: 0 });
  });
});

describe("validateRows — creating clients (F32)", () => {
  it("creates a client nothing on file resembles", () => {
    const result = validate([row({ clientName: "Zenith Graphics" })]);

    expect(result.rows[0]!.status).toBe("warning");
    expect(result.rows[0]!.reasons.join(" ")).toContain("will be created");
    expect(result.rows[0]!.parsed!.clientId).toBeNull();
    expect(result.summary.clients).toMatchObject({ toCreate: 1, needsReview: 0 });
  });

  it("stores the name as typed, casing and all", () => {
    // Normalising is for comparing. What the person wrote is what goes in.
    const result = validate([row({ clientName: "  ZeNith   Graphics  " })]);

    expect(result.rows[0]!.parsed!.clientName).toBe("ZeNith   Graphics");
    expect(clientsToCreate(result)[0]!.name).toBe("ZeNith   Graphics");
  });

  it("resolves two rows normalising to the same name to ONE client", () => {
    // Requirement 5. Two spellings, one customer, one row in the master.
    const result = validate([
      row({ rowNumber: 2, clientName: "Zenith Graphics", poNo: "Z-1" }),
      row({ rowNumber: 3, clientName: "ZENITH GRAPHICS PVT LTD", poNo: "Z-2" }),
    ]);

    expect(result.rows[0]!.parsed!.newClientKey).toBe(result.rows[1]!.parsed!.newClientKey);
    expect(clientsToCreate(result)).toHaveLength(1);
    expect(result.summary.clients.toCreate).toBe(1);
  });

  it("does not create a client whose only row is a skipped duplicate", () => {
    const first = validate([row({ clientName: "Zenith Graphics" })]);
    const key = dedupeKey(
      first.rows[0]!.parsed!.clientToken,
      first.rows[0]!.parsed!.poNo,
      first.rows[0]!.parsed!.itemName,
    );

    const second = validate([row({ clientName: "Zenith Graphics" })], [key]);

    expect(second.summary.duplicate).toBe(1);
    expect(clientsToCreate(second)).toHaveLength(0);
    // And the row does not claim both things at once.
    expect(second.rows[0]!.reasons.join(" ")).not.toContain("will be created");
  });
});

describe("validateRows — near matches go to review (F32)", () => {
  it("neither creates nor assumes when a name is close to an existing client", () => {
    // The whole point of the change: auto-create must not be able to produce a
    // duplicate. "Nture Packging" is a typo, not a new customer.
    const result = validate([row({ clientName: "Nture Packging" })]);

    expect(result.rows[0]!.status).toBe("review");
    expect(result.rows[0]!.parsed).toBeUndefined();
    expect(result.rows[0]!.review!.candidates[0]!.name).toBe(NAT.name);
    expect(result.summary.clients).toMatchObject({ toCreate: 0, needsReview: 1 });
  });

  it("leaves an undecided row out of the import, and lets the rest through", () => {
    // Same rule as a bad date: one row's problem stops that row only.
    const result = validate([
      row({ rowNumber: 2, clientName: "Nture Packging", poNo: "A-1" }),
      row({ rowNumber: 3, clientName: "Multipack Industries", poNo: "A-2" }),
    ]);

    expect(result.summary.review).toBe(1);
    expect(importableRows(result).map((r) => r.rowNumber)).toEqual([3]);
  });

  it("uses the existing client once that decision is made", () => {
    const first = validate([row({ clientName: "Nture Packging" })]);
    const key = first.rows[0]!.review!.key;

    const decided = validate([row({ clientName: "Nture Packging" })], [], { [key]: NAT.id });

    expect(decided.rows[0]!.status).toBe("ok");
    expect(decided.rows[0]!.parsed!.clientId).toBe(NAT.id);
    expect(decided.summary.clients).toMatchObject({ matched: 1, needsReview: 0 });
  });

  it("creates it instead once THAT decision is made", () => {
    const first = validate([row({ clientName: "Nture Packging" })]);
    const key = first.rows[0]!.review!.key;

    const decided = validate([row({ clientName: "Nture Packging" })], [], {
      [key]: CREATE_NEW,
    });

    expect(decided.rows[0]!.parsed!.clientId).toBeNull();
    expect(clientsToCreate(decided)[0]!.name).toBe("Nture Packging");
  });

  it("falls back to review when the decision names a client that has gone", () => {
    // The preview travelled through the browser and the database may have
    // moved on (F30). Ignoring the stale answer would import the row against
    // nothing; honouring it is impossible.
    const first = validate([row({ clientName: "Nture Packging" })]);
    const key = first.rows[0]!.review!.key;

    const stale = validate([row({ clientName: "Nture Packging" })], [], {
      [key]: "99999999-9999-9999-9999-999999999999",
    });

    expect(stale.rows[0]!.status).toBe("review");
  });

  it("answers every row spelling the client the same way, from one decision", () => {
    // Requirement 5 again, through the review path: one answer, one client.
    const first = validate([row({ clientName: "Nture Packging" })]);
    const key = first.rows[0]!.review!.key;

    const decided = validate(
      [
        row({ rowNumber: 2, clientName: "Nture Packging", poNo: "A-1" }),
        row({ rowNumber: 3, clientName: "NTURE PACKGING PVT LTD", poNo: "A-2" }),
      ],
      [],
      { [key]: CREATE_NEW },
    );

    expect(decided.rows[0]!.parsed!.newClientKey).toBe(decided.rows[1]!.parsed!.newClientKey);
    expect(clientsToCreate(decided)).toHaveLength(1);
  });

  it("groups the rows waiting on one answer together", () => {
    const result = validate([
      row({ rowNumber: 2, clientName: "Nture Packging", poNo: "A-1" }),
      row({ rowNumber: 3, clientName: "Nture Packging", poNo: "A-2" }),
    ]);

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]!.rowNumbers).toEqual([2, 3]);
  });

  it("refuses a name that matches two clients equally well", () => {
    const twins = [
      { id: "a", code: "ACM", name: "Acme Packaging" },
      { id: "b", code: "ACP", name: "Acme Packaging Pvt Ltd" },
    ];

    const result = validateRows([row({ clientName: "Acme Packaging" })], {
      clients: twins,
      existingKeys: new Set(),
    });

    expect(result.rows[0]!.status).toBe("error");
    expect(result.rows[0]!.reasons.join(" ")).toContain("client CODE");
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
      row({ poDate: "nope", orderedQty: "-5", itemName: "", clientName: "" }),
    ]);
    expect(result.rows[0]!.reasons.length).toBeGreaterThanOrEqual(4);
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
      dedupeKey(r.parsed!.clientToken, r.parsed!.poNo, r.parsed!.itemName),
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
