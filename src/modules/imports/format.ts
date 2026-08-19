import type { RawRow } from "./validate";

/**
 * THE FILE FORMAT — one definition, used by both the template writer and the
 * parser.
 *
 * If these disagree, the template teaches people to fill in a file the importer
 * cannot read, and the error appears as "PO date is blank" on every row of a
 * spreadsheet where the PO date is plainly filled in. Keeping the order and the
 * headings in one array is what stops that.
 */
export type ImportField = keyof Omit<RawRow, "rowNumber">;

export const COLUMNS: {
  field: ImportField;
  header: string;
  width: number;
  /** Shown under the header in the template, as a filling-in instruction. */
  hint: string;
  /**
   * Dates need declaring, because a spreadsheet does not distinguish them from
   * numbers on the way out. A cell holding 5 April 2026 with no date format
   * reads back as 46117, and 46117 is a perfectly plausible quantity — only
   * knowing which COLUMN it came from makes it a date.
   */
  isDate?: true;
}[] = [
  { field: "clientName", header: "Client", width: 28, hint: "Name or code, exactly as on the Clients screen" },
  { field: "poNo", header: "PO number", width: 16, hint: "The client's own number, from their document" },
  { isDate: true, field: "poDate", header: "PO date", width: 14, hint: "DD/MM/YYYY" },
  { field: "itemName", header: "Item", width: 32, hint: "What was made" },
  { field: "orderedQty", header: "Ordered qty", width: 13, hint: "Whole number" },
  { field: "rate", header: "Rate", width: 12, hint: "Per piece. Leave blank if not known" },
  { isDate: true, field: "committedDate", header: "Committed date", width: 16, hint: "DD/MM/YYYY, or blank if none was recorded" },
  { isDate: true, field: "dispatchDate", header: "Dispatch date", width: 15, hint: "DD/MM/YYYY. Blank if not dispatched" },
  { field: "dispatchedQty", header: "Dispatched qty", width: 15, hint: "Blank or 0 if not dispatched" },
  { field: "challanNo", header: "Challan no", width: 14, hint: "Blank allocates one. Repeat it to put items on one challan" },
];

/** One filled-in row, so nobody has to guess what a date should look like. */
export const EXAMPLE_ROW: Record<ImportField, string> = {
  clientName: "NAT",
  poNo: "4500123456",
  poDate: "05/04/2026",
  itemName: "250ml carton - outer",
  orderedQty: "1000",
  rate: "12.50",
  committedDate: "20/04/2026",
  dispatchDate: "18/04/2026",
  dispatchedQty: "1000",
  challanNo: "77",
};

export const SHEET_NAME = "Jobs";

/** Row indices in the generated workbook, 1-based as ExcelJS counts. */
export const HEADER_ROW = 1;
export const HINT_ROW = 2;
export const EXAMPLE_ROW_INDEX = 3;
export const FIRST_DATA_ROW = 4;
