import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { COLUMNS, EXAMPLE_ROW, FIRST_DATA_ROW, SHEET_NAME } from "@/modules/imports/format";
import { ImportParseError, parseWorkbook } from "@/modules/imports/parse";
import { buildTemplate } from "@/modules/imports/template";

/**
 * The template and the parser are two readings of one format, and nothing
 * except these tests makes them agree.
 *
 * When they drift, the failure is nasty in a particular way: the template
 * teaches somebody to fill in a file the importer cannot read, and the error
 * comes back as "PO date is blank" on every row of a spreadsheet where the PO
 * date is plainly filled in.
 */

/** Appends rows to a generated template and returns the bytes. */
async function templateWithRows(rows: Record<string, string | number | Date>[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildTemplate());

  const sheet = workbook.getWorksheet(SHEET_NAME)!;

  rows.forEach((values, index) => {
    const row = sheet.getRow(FIRST_DATA_ROW + index);
    COLUMNS.forEach((column, col) => {
      row.getCell(col + 1).value = values[column.field] ?? "";
    });
  });

  const out = await workbook.xlsx.writeBuffer();
  return out as ArrayBuffer;
}

describe("template", () => {
  it("has every column the parser looks for, in order", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate());

    const sheet = workbook.getWorksheet(SHEET_NAME);
    expect(sheet).toBeDefined();

    const headings = COLUMNS.map((_, i) => String(sheet!.getRow(1).getCell(i + 1).value));
    expect(headings).toEqual(COLUMNS.map((c) => c.header));
  });

  it("carries a filled-in example row", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate());
    const sheet = workbook.getWorksheet(SHEET_NAME)!;

    const example = COLUMNS.map((_, i) => String(sheet.getRow(3).getCell(i + 1).value));
    expect(example).toEqual(COLUMNS.map((c) => EXAMPLE_ROW[c.field]));
  });

  it("locks the header and leaves the data rows typeable", async () => {
    // Protecting without unlocking the data cells produces a template nobody
    // can type into, because Excel locks every cell by default.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate());
    const sheet = workbook.getWorksheet(SHEET_NAME)!;

    expect(sheet.getRow(1).getCell(1).protection?.locked).not.toBe(false);
    expect(sheet.getRow(FIRST_DATA_ROW).getCell(1).protection?.locked).toBe(false);
  });
});

describe("template round-trip", () => {
  it("parses rows written into its own template", async () => {
    const bytes = await templateWithRows([
      {
        clientName: "NAT",
        poNo: "PO-1",
        poDate: "05/04/2026",
        itemName: "Outer carton",
        orderedQty: "1000",
        rate: "12.50",
        committedDate: "20/04/2026",
        dispatchDate: "18/04/2026",
        dispatchedQty: "1000",
        challanNo: "77",
      },
    ]);

    const rows = await parseWorkbook(bytes);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientName: "NAT",
      poNo: "PO-1",
      poDate: "05/04/2026",
      itemName: "Outer carton",
      orderedQty: "1000",
      dispatchedQty: "1000",
    });
  });

  it("skips the example row rather than importing it", async () => {
    // Leaving it in is the single most likely mistake, and importing a 250ml
    // carton for NAT that never existed is worse than dropping a row.
    const bytes = await templateWithRows([
      { clientName: "MUL", poNo: "PO-2", poDate: "06/04/2026", itemName: "Tray", orderedQty: "5" },
    ]);

    const rows = await parseWorkbook(bytes);
    expect(rows.map((r) => r.itemName)).toEqual(["Tray"]);
  });

  it("skips blank trailing rows", async () => {
    const bytes = await templateWithRows([
      { clientName: "NAT", poNo: "PO-3", poDate: "06/04/2026", itemName: "Tray", orderedQty: "5" },
      {},
      {},
    ]);

    expect(await parseWorkbook(bytes)).toHaveLength(1);
  });

  it("reads a real date cell as the day that was typed, not the server's day", async () => {
    // A date cell arrives as a Date built from the workbook serial, carrying no
    // timezone. Reading it with local getters can shift it a day.
    const bytes = await templateWithRows([
      {
        clientName: "NAT",
        poNo: "PO-4",
        poDate: new Date(Date.UTC(2026, 3, 5)),
        itemName: "Sleeve",
        orderedQty: "10",
      },
    ]);

    const rows = await parseWorkbook(bytes);
    expect(rows[0]!.poDate).toBe("2026-04-05");
  });

  it("keeps the row number the person sees in the spreadsheet", async () => {
    const bytes = await templateWithRows([
      { clientName: "NAT", poNo: "PO-5", poDate: "06/04/2026", itemName: "A", orderedQty: "1" },
      { clientName: "NAT", poNo: "PO-6", poDate: "06/04/2026", itemName: "B", orderedQty: "1" },
    ]);

    const rows = await parseWorkbook(bytes);
    expect(rows.map((r) => r.rowNumber)).toEqual([FIRST_DATA_ROW, FIRST_DATA_ROW + 1]);
  });
});

describe("parse failures", () => {
  it("names the missing columns rather than failing row by row", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.getRow(1).values = ["Client", "PO number"];
    sheet.getRow(4).values = ["NAT", "PO-1"];

    const bytes = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    await expect(parseWorkbook(bytes)).rejects.toThrow(ImportParseError);
    await expect(parseWorkbook(bytes)).rejects.toThrow(/missing columns[\s\S]*PO date/);
  });

  it("refuses a file that is not a spreadsheet", async () => {
    const bytes = new TextEncoder().encode("this is not a workbook").buffer as ArrayBuffer;
    await expect(parseWorkbook(bytes)).rejects.toThrow(/could not be read/);
  });

  it("refuses a template with nothing filled in", async () => {
    const bytes = await templateWithRows([]);
    await expect(parseWorkbook(bytes)).rejects.toThrow(/no rows/);
  });
});
