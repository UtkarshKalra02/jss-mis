import { describe, expect, it } from "vitest";

import {
  paperCount,
  paperQuantityLine,
  paperWorking,
  SHEETS_PER_BUNDLE,
} from "@/modules/job-cards/paper";

/**
 * The paper detail arithmetic — decision J18.
 *
 * No database, no session, no browser, on F25's reasoning: this is the sum the
 * floor will check against a calculator, and the argument a year from now is
 * far easier to settle against a test than against a rendered form.
 */

describe("the trade's bundles", () => {
  it("holds the fixed sheet counts the godown deals in", () => {
    // These are trade facts, not settings. If one of them changes, it is
    // because somebody decided to change it, and this test should be the
    // thing that makes them say so out loud.
    expect(SHEETS_PER_BUNDLE.Packet).toBe(100);
    expect(SHEETS_PER_BUNDLE.Ream).toBe(500);
    expect(SHEETS_PER_BUNDLE.Gross).toBe(144);
  });
});

describe("paperCount", () => {
  it("multiplies bundles into parent sheets, then parts into press sheets", () => {
    // The worked example: 5 packets, cut in 2.
    const c = paperCount({ qty: 5, bundle: "Packet", parts: 2 });

    expect(c.parentSheets).toBe(500);
    expect(c.pressSheets).toBe(1000);
    expect(c.sheetsPerBundle).toBe(100);
  });

  it("treats a blank parts box as uncut rather than unknown", () => {
    // Most jobs are not cut at all, so both figures are the same number and
    // that is the honest answer, not a gap.
    for (const parts of [null, undefined, 1]) {
      const c = paperCount({ qty: 3, bundle: "Ream", parts });
      expect(c.parentSheets).toBe(1500);
      expect(c.pressSheets).toBe(1500);
    }
  });

  it("counts a gross as 144, not 100 and not 500", () => {
    const c = paperCount({ qty: 2, bundle: "Gross", parts: 3 });
    expect(c.parentSheets).toBe(288);
    expect(c.pressSheets).toBe(864);
  });

  it("computes nothing from a quantity with no bundle", () => {
    // 5 of what? The database refuses the same pair (job_card_paper_bundle_
    // required) and the form says so in words. Guessing a bundle here would
    // print a sheet count nobody chose.
    const c = paperCount({ qty: 5, bundle: null, parts: 2 });
    expect(c.parentSheets).toBeNull();
    expect(c.pressSheets).toBeNull();
  });

  it("reports the bundle size before a quantity is typed", () => {
    // So the dropdown can show its multiplier the moment it is chosen.
    const c = paperCount({ qty: null, bundle: "Ream", parts: null });
    expect(c.sheetsPerBundle).toBe(500);
    expect(c.parentSheets).toBeNull();
  });

  it("refuses to turn a typo into a press run of zero", () => {
    // Zero or negative parts is not "cut into nothing", it is a mistake. Fall
    // back to uncut rather than printing 0 sheets on the card the floor works
    // from. The check constraint refuses to store it either way.
    for (const parts of [0, -2]) {
      const c = paperCount({ qty: 4, bundle: "Packet", parts });
      expect(c.parentSheets).toBe(400);
      expect(c.pressSheets).toBe(400);
    }
  });

  it("computes nothing from a quantity of zero or less", () => {
    for (const qty of [0, -5]) {
      expect(paperCount({ qty, bundle: "Packet", parts: 2 }).parentSheets).toBeNull();
    }
  });
});

describe("how the figures explain themselves", () => {
  it("shows the working behind the parent-sheet total", () => {
    expect(paperWorking({ qty: 5, bundle: "Packet" })).toBe("5 packets × 100");
    expect(paperWorking({ qty: 1, bundle: "Ream" })).toBe("1 ream × 500");
  });

  it("says the quantity the way the godown says it", () => {
    expect(paperQuantityLine({ paperQty: 5, paperBundle: "Packet" })).toBe("5 packets");
    expect(paperQuantityLine({ paperQty: 1, paperBundle: "Gross" })).toBe("1 gross");

    // Gross does not pluralise. "2 grosss" reads as a bug in the system
    // rather than as a quantity.
    expect(paperQuantityLine({ paperQty: 2, paperBundle: "Gross" })).toBe("2 gross");
    expect(paperWorking({ qty: 2, bundle: "Gross" })).toBe("2 gross × 144");
    expect(paperQuantityLine({ paperQty: null, paperBundle: "Ream" })).toBeNull();
  });
});
