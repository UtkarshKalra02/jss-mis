import { sql } from "drizzle-orm";

import type { Tx } from "@/db/audit";
import { numberSeries } from "@/db/schema";

/**
 * DOCUMENT NUMBERING — the Indian financial year allocator.
 *
 * Produces PO-2025-0001, ITM-2025-00001, DSN-00001, and so on. Every document
 * this system raises gets its number from here; there is no second place that
 * formats one.
 *
 * Three properties matter, and each is load-bearing:
 *
 *   1. The year is the INDIAN FINANCIAL YEAR, April to March (decision C7).
 *      PO-2025-0001 is the first PO of April 2025 through March 2026.
 *
 *   2. The year comes from the DOCUMENT's own date, not from today (F10). A
 *      PO dated 28 March 2025 belongs to FY 2024-25 whether it was entered
 *      that week or backfilled a year later. This is what lets the historical
 *      import produce numbers that read correctly.
 *
 *   3. Allocation happens inside the caller's transaction, and cannot happen
 *      outside one — `tx` is required, not optional. If the row being numbered
 *      fails to insert, the allocation rolls back with it and the number is
 *      not burnt.
 *
 * NOTE ON THE AUDIT WRAPPER (decision F9): this is the one table Phase 2
 * writes outside src/db/audit.ts. A counter bump is bookkeeping, not a
 * business record change — the same reasoning that keeps last_login_at out of
 * the wrapper (E5). Nothing is lost: the number ends up as a column on the row
 * that consumed it, and THAT insert is audited.
 */

/* -------------------------------------------------------------------------- */
/* Series configuration                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Every series the system issues.
 *
 * `padding` lives here rather than being read back from the number_series row
 * because it is a display rule, and changing it should be a code change with a
 * diff attached — not a data edit that silently renumbers future documents
 * into a different shape from every document already printed. The column on
 * the table records what was used and is not consulted when formatting.
 *
 * `yearScoped: false` means the counter runs continuously and the number has
 * no year segment at all. DSN is the only one: a die or plate design outlives
 * any financial year, so restarting it every April would be meaningless.
 */
export const SERIES = {
  ENQ: { padding: 4, yearScoped: true, label: "Enquiry" },
  QT: { padding: 4, yearScoped: true, label: "Quotation" },
  PO: { padding: 4, yearScoped: true, label: "Purchase order" },
  ITM: { padding: 5, yearScoped: true, label: "PO item" },
  JC: { padding: 4, yearScoped: true, label: "Job card" },
  PR: { padding: 4, yearScoped: true, label: "Press run" },
  CH: { padding: 4, yearScoped: true, label: "Challan" },
  RCP: { padding: 4, yearScoped: true, label: "Receipt" },
  DSN: { padding: 5, yearScoped: false, label: "Design" },
} as const;

export type SeriesPrefix = keyof typeof SERIES;

/** Stored in number_series.fy_start for series that do not restart each April. */
const NOT_YEAR_SCOPED = 0;

/* -------------------------------------------------------------------------- */
/* Financial year                                                              */
/* -------------------------------------------------------------------------- */

const IST = "Asia/Kolkata";

/**
 * Today's calendar date in the factory's timezone, as 'YYYY-MM-DD'.
 *
 * The TypeScript counterpart of today_ist() in the views migration, and it
 * exists for the same reason (decision C10): a document entered at 2am IST is
 * 20:30 UTC the PREVIOUS day, so asking a UTC clock what today is puts it in
 * the wrong financial year for four and a half hours every night — and on 1
 * April, in the wrong YEAR.
 *
 * 'en-CA' is used because it formats as ISO 8601, which is the one thing every
 * other locale gets differently.
 */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * The financial year a date falls in, as the calendar year it STARTS in.
 *
 * April 2025 through March 2026 is financial year 2025. So:
 *   2025-03-31 -> 2024   (still the tail of FY 2024-25)
 *   2025-04-01 -> 2025   (first day of FY 2025-26)
 *
 * Accepts the plain 'YYYY-MM-DD' string that Postgres date columns come back
 * as, which is deliberately the only string form allowed: those are calendar
 * dates with no timezone, and parsing them through Date would reintroduce
 * exactly the shift todayIST() exists to avoid. A Date is accepted too and is
 * read in IST.
 */
export function financialYearStart(on: Date | string = todayIST()): number {
  const iso =
    typeof on === "string"
      ? on
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: IST,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(on);

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    throw new Error(
      `Cannot work out a financial year from "${String(on)}". Expected a Date or 'YYYY-MM-DD'.`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]); // 1-12

  // January, February and March belong to the financial year that began the
  // previous April.
  return month >= 4 ? year : year - 1;
}

/** "2025-26", for screens and headings. */
export function financialYearLabel(fyStart: number): string {
  return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Assembles the printed number.
 *
 * Padding is a MINIMUM, never a truncation. The 10,000th PO of a year is
 * PO-2025-10000, not PO-2025-0000 — a number that silently wrapped would
 * collide with one already issued, and the partial unique index would reject
 * the insert with a message about a duplicate key rather than about running
 * out of numbers.
 */
export function formatNumber(prefix: SeriesPrefix, fyStart: number, n: number): string {
  const padded = String(n).padStart(SERIES[prefix].padding, "0");
  return SERIES[prefix].yearScoped ? `${prefix}-${fyStart}-${padded}` : `${prefix}-${padded}`;
}

/* -------------------------------------------------------------------------- */
/* Allocation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Takes the next number in a series and returns it formatted.
 *
 * MUST be called inside the transaction that creates the row being numbered.
 * That is why `tx` is the first argument and is not optional: a number
 * allocated in its own transaction is committed whether or not the document
 * survives, so a failed save would leave a permanent gap.
 *
 * @param on  the DOCUMENT's date — po_date, dispatch_date, enquiry_date —
 *            which decides the financial year (F10). Defaults to today in IST.
 *            Ignored for series that are not year-scoped.
 *
 * Concurrency (decision C7): the whole allocation is one statement. INSERT ...
 * ON CONFLICT DO UPDATE creates the series row the first time a document of
 * this type is raised in this financial year, and increments it every time
 * after. Postgres takes a row lock on conflict, so two people entering POs at
 * the same instant block on each other for the duration of one UPDATE and come
 * away with different numbers. Reading the counter and then writing it back as
 * two statements is what would let them both read 6 and both write 7.
 *
 * The series row is created on demand rather than seeded, so nobody has to
 * remember to add rows every April.
 */
export async function allocateNumber(
  tx: Tx,
  prefix: SeriesPrefix,
  on?: Date | string,
): Promise<string> {
  const fyStart = SERIES[prefix].yearScoped
    ? financialYearStart(on ?? todayIST())
    : NOT_YEAR_SCOPED;

  const [row] = await tx
    .insert(numberSeries)
    .values({
      prefix,
      fyStart,
      lastNumber: 1,
      padding: SERIES[prefix].padding,
    })
    .onConflictDoUpdate({
      target: [numberSeries.prefix, numberSeries.fyStart],
      // Unqualified here refers to the EXISTING row; `excluded` would be the
      // row we just tried to insert, which is always 1.
      set: { lastNumber: sql`${numberSeries.lastNumber} + 1` },
    })
    .returning({ lastNumber: numberSeries.lastNumber });

  if (!row) {
    // Unreachable in practice: the statement either inserts or updates, and
    // both return a row. Guarded anyway, because silently returning a
    // malformed number would be far worse than failing here.
    throw new Error(`Could not allocate a ${SERIES[prefix].label} number.`);
  }

  return formatNumber(prefix, fyStart, row.lastNumber);
}
