import ExcelJS from "exceljs";

import { COLUMNS, EXAMPLE_ROW, FIRST_DATA_ROW, HEADER_ROW } from "./format";
import type { RawRow } from "./validate";

export class ImportParseError extends Error {}

/**
 * Reads an uploaded workbook into plain strings.
 *
 * Deliberately does no validation. Its whole job is to get the file into the
 * shape validate.ts expects, so that every rule about what is acceptable lives
 * in one testable place rather than being split between "the parser rejected
 * it" and "the validator rejected it".
 *
 * DATE CELLS ARE THE SUBTLE PART. A cell somebody formatted as a real date
 * arrives as a JavaScript Date built from the workbook's serial number, which
 * carries no timezone. Reading it with getFullYear() would apply the server's
 * offset and could shift it a day; the UTC parts are the date that was typed.
 * It is emitted as ISO, which validate.ts accepts alongside DD/MM/YYYY.
 */
export async function parseWorkbook(buffer: ArrayBuffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportParseError(
      "That file could not be read as a spreadsheet. Save it as .xlsx and try again.",
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportParseError("That workbook has no sheets in it.");

  // Match on the headings rather than trusting column order, so a file with a
  // column dragged sideways still imports.
  const headerRow = sheet.getRow(HEADER_ROW);
  const columnFor = new Map<string, number>();

  headerRow.eachCell((cell, colNumber) => {
    const heading = String(cell.value ?? "").trim().toLowerCase();
    if (heading) columnFor.set(heading, colNumber);
  });

  const missing = COLUMNS.filter((c) => !columnFor.has(c.header.toLowerCase()));
  if (missing.length > 0) {
    throw new ImportParseError(
      `This file is missing ${missing.length === 1 ? "a column" : "columns"}: ${missing
        .map((c) => c.header)
        .join(", ")}. Download the template and use that.`,
    );
  }

  const rows: RawRow[] = [];

  for (let rowNumber = FIRST_DATA_ROW - 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);

    const values = Object.fromEntries(
      COLUMNS.map((c) => [
        c.field,
        cellText(row.getCell(columnFor.get(c.header.toLowerCase())!), c.isDate ?? false),
      ]),
    ) as Record<(typeof COLUMNS)[number]["field"], string>;

    // Wholly blank rows are the trailing empties every spreadsheet has.
    if (Object.values(values).every((v) => v.length === 0)) continue;

    // The template ships with an example row. Leaving it in is the single most
    // likely mistake, and importing a 250ml carton for NAT that never existed
    // is worse than skipping a row somebody meant to keep.
    if (isExampleRow(values)) continue;

    rows.push({ rowNumber, ...values });
  }

  if (rows.length === 0) {
    throw new ImportParseError("That file has no rows in it below the example row.");
  }

  return rows;
}

function isExampleRow(values: Record<string, string>): boolean {
  return COLUMNS.every(
    (c) => values[c.field]!.trim().toLowerCase() === EXAMPLE_ROW[c.field].toLowerCase(),
  );
}

/**
 * One cell as the string a person would say it contains.
 *
 * `isDate` matters because a spreadsheet does not distinguish a date from a
 * number on the way out: a cell holding 5 April 2026 without a date format
 * comes back as 46117, and 46117 is a perfectly plausible quantity. Converting
 * only in the columns that are declared dates is what keeps an ordered quantity
 * from being read as the year 2026.
 */
function cellText(cell: ExcelJS.Cell, isDate: boolean): string {
  const value = cell.value;

  if (value === null || value === undefined) return "";

  if (isDate && typeof value === "number") return fromExcelSerial(value);

  if (value instanceof Date) {
    // UTC parts: the serial date carries no timezone, and applying the
    // server's offset can move it a day.
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof value === "object") {
    // Formula results, rich text, hyperlinks — all carry the displayed value.
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value) return value.richText.map((t) => t.text).join("").trim();
    if ("text" in value) return String(value.text ?? "").trim();
  }

  return String(value).trim();
}

/**
 * An Excel date serial to YYYY-MM-DD.
 *
 * Day 1 is 1 January 1900, and the epoch is written as 30 December 1899 to
 * absorb Excel's deliberate 1900-leap-year bug — 1900 was not a leap year, but
 * Excel says it was, and every serial after February 1900 is shifted by one to
 * match. Computed entirely in UTC so the server's offset cannot move the day.
 */
function fromExcelSerial(serial: number): string {
  const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  const date = new Date(EXCEL_EPOCH_UTC + Math.round(serial) * 86_400_000);

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
