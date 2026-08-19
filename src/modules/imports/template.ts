import ExcelJS from "exceljs";

import {
  COLUMNS,
  EXAMPLE_ROW,
  EXAMPLE_ROW_INDEX,
  HEADER_ROW,
  HINT_ROW,
  SHEET_NAME,
} from "./format";

/**
 * Builds the downloadable .xlsx template.
 *
 * A real workbook rather than a CSV with a different extension, because the
 * requirement asks for a locked header row — and because a CSV opened in Excel
 * mangles a date column without asking anyone.
 *
 * The sheet is protected with every DATA cell explicitly unlocked. Excel's
 * default is that all cells are locked and protection makes that bite, so
 * protecting without unlocking would produce a template nobody can type into.
 * The password is deliberately a known constant: this is a guard rail against
 * accidentally renaming a column, not a security control, and a template
 * somebody genuinely needs to restructure should not need a call to unlock.
 */
export async function buildTemplate(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JSS MIS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: HINT_ROW }],
  });

  sheet.columns = COLUMNS.map((c) => ({
    key: c.field,
    width: c.width,
    // Declaring the format means a date typed here stays a date on the way
    // back, rather than arriving as a bare serial number.
    style: c.isDate ? { numFmt: "dd/mm/yyyy" } : {},
  }));

  const header = sheet.getRow(HEADER_ROW);
  const hints = sheet.getRow(HINT_ROW);
  const example = sheet.getRow(EXAMPLE_ROW_INDEX);

  COLUMNS.forEach((column, index) => {
    const col = index + 1;

    header.getCell(col).value = column.header;
    header.getCell(col).font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.getCell(col).fill = {
      type: "pattern",
      pattern: "solid",
      // The brand indigo from E16, so the template looks like the app.
      fgColor: { argb: "FF3B3288" },
    };
    header.getCell(col).alignment = { vertical: "middle" };

    hints.getCell(col).value = column.hint;
    hints.getCell(col).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    hints.getCell(col).alignment = { wrapText: true, vertical: "top" };

    example.getCell(col).value = EXAMPLE_ROW[column.field];
    example.getCell(col).font = { color: { argb: "FF94A3B8" } };
  });

  header.height = 22;
  hints.height = 30;

  // Everything from the example row down is typed into, so it must be
  // unlocked BEFORE protection is applied.
  for (let row = EXAMPLE_ROW_INDEX; row <= 500; row += 1) {
    for (let col = 1; col <= COLUMNS.length; col += 1) {
      sheet.getRow(row).getCell(col).protection = { locked: false };
    }
  }

  await sheet.protect("jss", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    insertRows: true,
    deleteRows: true,
    sort: true,
    autoFilter: true,
  });

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
