import { describe, expect, it } from "vitest";

import { formatINR, formatINRPrecise, formatQty, formatTime } from "@/lib/format";

/**
 * Money formatting, and the distinction between the two functions.
 *
 * These are pure, so they need no database — and they are worth pinning
 * because the bug they exist to prevent was invisible in every other test. The
 * purchase order screen rendered a rate of ₹4.50 as "₹5" for weeks: the value
 * was stored correctly as numeric(14,2), the form accepted the paise, and only
 * the display rounded them away. Nothing failed. It just printed a different
 * number from the one on the customer's purchase order.
 */

describe("per-unit rates keep their paise", () => {
  it("shows the paise a rate actually carries", () => {
    expect(formatINRPrecise("4.50")).toBe("₹4.50");
    expect(formatINRPrecise("2.75")).toBe("₹2.75");
    expect(formatINRPrecise(6)).toBe("₹6.00");
  });

  it("does NOT round a rate to the nearest rupee", () => {
    // The bug. ₹4.50 as "₹5" is an 11% misstatement of a number somebody is
    // checking against a purchase order line by line.
    expect(formatINRPrecise("4.50")).not.toBe("₹5");
    expect(formatINR("4.50")).toBe("₹5");
  });

  it("accepts the string Postgres returns for numeric(14,2)", () => {
    // drizzle hands back numeric columns as strings, not numbers.
    expect(formatINRPrecise("12345.60")).toBe("₹12,345.60");
  });
});

describe("Indian grouping, per section 7", () => {
  it("groups in lakhs and crores, not thousands", () => {
    // ₹12,34,560 — not ₹1,234,560. The difference is the whole point of the
    // en-IN locale here.
    expect(formatINR(1234560)).toBe("₹12,34,560");
    expect(formatINRPrecise(1234560.75)).toBe("₹12,34,560.75");
    expect(formatQty(1234560)).toBe("12,34,560");
  });
});

describe("nothing is rendered as a confident zero", () => {
  it("shows an em dash where there is no value", () => {
    // A missing rate is not a rate of zero, and the difference matters on a
    // screen somebody prices work from.
    for (const empty of [null, undefined, ""]) {
      expect(formatINR(empty)).toBe("—");
      expect(formatINRPrecise(empty)).toBe("—");
      expect(formatQty(empty)).toBe("—");
    }
  });

  it("shows an em dash rather than NaN for something unparseable", () => {
    expect(formatINRPrecise("not a number")).toBe("—");
    expect(formatQty("not a number")).toBe("—");
  });

  it("still shows a real zero", () => {
    expect(formatQty(0)).toBe("0");
    expect(formatINRPrecise(0)).toBe("₹0.00");
  });
});


/**
 * formatTime renders the IST clock time and nothing else. It exists because
 * the dashboard's stage feed needs the time under a heading that already
 * carries the date, and slicing formatDateTime's output apart on ", " depends
 * on a separator the locale is free to change.
 */
describe("formatTime", () => {
  it("renders IST, not UTC", () => {
    // 03:30 UTC is 09:00 IST — the +5:30 offset is the whole point.
    expect(formatTime(new Date("2026-10-12T03:30:00Z"))).toBe("9:00 am");
  });

  it("reads an ISO string as well as a Date, because the query returns text", () => {
    expect(formatTime("2026-10-12T14:45:00Z")).toBe("8:15 pm");
  });

  it("crosses midnight into the next IST day", () => {
    // 19:00 UTC is 00:30 the following morning in IST.
    expect(formatTime(new Date("2026-10-11T19:00:00Z"))).toBe("12:30 am");
  });

  it("shows an em dash rather than NaN for nothing, or for rubbish", () => {
    expect(formatTime(null)).toBe("—");
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("not a date")).toBe("—");
  });
});
