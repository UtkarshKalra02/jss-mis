import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { numberSeries } from "@/db/schema";
import {
  allocateNumber,
  financialYearLabel,
  financialYearStart,
  formatNumber,
  SERIES,
} from "@/lib/numbering";

import { inRollback } from "./helpers";

/**
 * The allocator is the one thing every Phase 2 document depends on, and it
 * fails in two ways that are silently expensive: a wrong financial year is
 * only noticed when somebody reads a number back months later, and a collision
 * is only noticed when the unique index rejects a save that a person was in
 * the middle of.
 *
 * The pure functions are tested directly. Allocation is tested against the
 * real database inside rolled-back transactions, because the property being
 * asserted — that two concurrent allocations cannot collide — is a property of
 * Postgres's ON CONFLICT, not of this TypeScript.
 */

/** A financial year far enough out that no real document can be in it. */
const FUTURE_FY_DATE = "2099-06-01";
const FUTURE_FY = 2099;

describe("financialYearStart", () => {
  it("puts April through December in the year that just started", () => {
    expect(financialYearStart("2025-04-01")).toBe(2025);
    expect(financialYearStart("2025-08-18")).toBe(2025);
    expect(financialYearStart("2025-12-31")).toBe(2025);
  });

  it("puts January through March in the year that began the previous April", () => {
    expect(financialYearStart("2026-01-01")).toBe(2025);
    expect(financialYearStart("2026-03-31")).toBe(2025);
  });

  // The one that actually breaks in production: two consecutive days landing
  // in different financial years.
  it("moves the year over the 31 March / 1 April boundary", () => {
    expect(financialYearStart("2025-03-31")).toBe(2024);
    expect(financialYearStart("2025-04-01")).toBe(2025);
  });

  it("accepts a Date and reads it in IST", () => {
    // 2025-04-01T00:30 IST is 2025-03-31T19:00 UTC. Read as UTC this is the
    // PREVIOUS financial year; read in IST it is the new one.
    expect(financialYearStart(new Date("2025-03-31T19:00:00Z"))).toBe(2025);
  });

  it("refuses a date it cannot parse rather than guessing a year", () => {
    expect(() => financialYearStart("01/04/2025")).toThrow(/financial year/i);
  });
});

describe("financialYearLabel", () => {
  it("renders the April-March span", () => {
    expect(financialYearLabel(2025)).toBe("2025-26");
    expect(financialYearLabel(2099)).toBe("2099-00");
  });
});

describe("formatNumber", () => {
  it("pads year-scoped series to their configured width", () => {
    expect(formatNumber("PO", 2025, 1)).toBe("PO-2025-0001");
    expect(formatNumber("ITM", 2025, 1)).toBe("ITM-2025-00001");
    expect(formatNumber("CH", 2025, 42)).toBe("CH-2025-0042");
  });

  it("omits the year entirely for series that do not restart", () => {
    expect(formatNumber("DSN", 0, 7)).toBe("DSN-00007");
  });

  // Padding is a minimum. A number that wrapped would collide with one already
  // printed on a document somebody is holding.
  it("grows past the padding rather than truncating", () => {
    expect(formatNumber("PO", 2025, 10_000)).toBe("PO-2025-10000");
    expect(formatNumber("DSN", 0, 123_456)).toBe("DSN-123456");
  });
});

describe("allocateNumber", () => {
  it("issues 0001 for the first document of a financial year", async () => {
    await inRollback(async (tx) => {
      expect(await allocateNumber(tx, "PO", FUTURE_FY_DATE)).toBe(`PO-${FUTURE_FY}-0001`);
    });
  });

  it("increments within a series", async () => {
    await inRollback(async (tx) => {
      expect(await allocateNumber(tx, "PO", FUTURE_FY_DATE)).toBe(`PO-${FUTURE_FY}-0001`);
      expect(await allocateNumber(tx, "PO", FUTURE_FY_DATE)).toBe(`PO-${FUTURE_FY}-0002`);
      expect(await allocateNumber(tx, "PO", FUTURE_FY_DATE)).toBe(`PO-${FUTURE_FY}-0003`);
    });
  });

  it("keeps each prefix on its own counter", async () => {
    await inRollback(async (tx) => {
      await allocateNumber(tx, "PO", FUTURE_FY_DATE);
      await allocateNumber(tx, "PO", FUTURE_FY_DATE);

      // ITM is untouched by the two POs above, and pads to five.
      expect(await allocateNumber(tx, "ITM", FUTURE_FY_DATE)).toBe(`ITM-${FUTURE_FY}-00001`);
      expect(await allocateNumber(tx, "PO", FUTURE_FY_DATE)).toBe(`PO-${FUTURE_FY}-0003`);
    });
  });

  it("restarts a year-scoped series in the new financial year", async () => {
    await inRollback(async (tx) => {
      expect(await allocateNumber(tx, "PO", "2098-06-01")).toBe("PO-2098-0001");
      expect(await allocateNumber(tx, "PO", "2098-06-02")).toBe("PO-2098-0002");

      // Crossing 1 April starts a fresh counter, and does not disturb the old.
      expect(await allocateNumber(tx, "PO", "2099-04-01")).toBe("PO-2099-0001");
      expect(await allocateNumber(tx, "PO", "2099-03-31")).toBe("PO-2098-0003");
    });
  });

  // F10: the document's date decides the year, not the day it was typed.
  it("numbers a backdated document into the financial year it belongs to", async () => {
    await inRollback(async (tx) => {
      const number = await allocateNumber(tx, "PO", "2098-03-15");
      expect(number).toBe("PO-2097-0001");
    });
  });

  it("runs DSN continuously, ignoring the financial year", async () => {
    await inRollback(async (tx) => {
      expect(await allocateNumber(tx, "DSN", "2098-06-01")).toMatch(/^DSN-\d{5,}$/);

      const [row] = await tx
        .select({ lastNumber: numberSeries.lastNumber })
        .from(numberSeries)
        .where(and(eq(numberSeries.prefix, "DSN"), eq(numberSeries.fyStart, 0)));

      // One series row, at fy_start 0 — not one per year.
      expect(row).toBeDefined();

      const next = await allocateNumber(tx, "DSN", "2099-06-01");
      expect(next).toBe(formatNumber("DSN", 0, row!.lastNumber + 1));
    });
  });

  it("creates the series row on demand rather than needing it seeded", async () => {
    await inRollback(async (tx) => {
      await allocateNumber(tx, "JC", FUTURE_FY_DATE);

      const [row] = await tx
        .select()
        .from(numberSeries)
        .where(and(eq(numberSeries.prefix, "JC"), eq(numberSeries.fyStart, FUTURE_FY)));

      expect(row).toBeDefined();
      expect(row!.lastNumber).toBe(1);
      expect(row!.padding).toBe(SERIES.JC.padding);
    });
  });

  it("gives up the number when the transaction rolls back", async () => {
    await inRollback(async (tx) => {
      await allocateNumber(tx, "RCP", FUTURE_FY_DATE);
      await allocateNumber(tx, "RCP", FUTURE_FY_DATE);
    });

    // The rollback above must have taken the counter with it, or a failed save
    // would leave a permanent gap in the sequence.
    await inRollback(async (tx) => {
      expect(await allocateNumber(tx, "RCP", FUTURE_FY_DATE)).toBe(`RCP-${FUTURE_FY}-0001`);
    });
  });

  /**
   * The property C7 exists for. Two transactions allocate at the same moment;
   * neither may come away with the number the other got.
   *
   * This one has to COMMIT — a rolled-back transaction never contends with
   * anything — so it uses a far-future financial year no real document can
   * occupy, and deletes the series row afterwards. That raw delete is the
   * escape hatch described in E3, used here deliberately: number_series is a
   * counter, not a business record, and there is nothing to soft delete.
   */
  it("does not issue the same number to two concurrent transactions", async () => {
    const fyDate = "2097-06-01";

    try {
      const [a, b] = await Promise.all([
        db.transaction((tx) => allocateNumber(tx, "CH", fyDate)),
        db.transaction((tx) => allocateNumber(tx, "CH", fyDate)),
      ]);

      expect(a).not.toBe(b);
      expect([a, b].sort()).toEqual(["CH-2097-0001", "CH-2097-0002"]);
    } finally {
      await db
        .delete(numberSeries)
        .where(and(eq(numberSeries.prefix, "CH"), eq(numberSeries.fyStart, 2097)));
    }
  });
});
