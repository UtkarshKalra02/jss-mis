import { describe, expect, it } from "vitest";

import {
  createEnquirySchema,
  parseEnquiryForm,
  statusChangeSchema,
} from "@/modules/enquiries/validation";

/**
 * The enquiry form's contract with the browser.
 *
 * Asserted against a REAL FormData rather than a hand-written object, which is
 * the entire point: `lostReason` and `lostNotes` are rendered only when the
 * status is Lost, so on every other status the browser posts nothing for them
 * and `FormData.get()` returns **null** — not undefined. Zod's `.optional()`
 * permits undefined and refuses null, so a schema that looks correct against a
 * hand-written object rejects the whole payload against a field the person
 * never saw.
 *
 * That is not a hypothetical. It silently refused EVERY delegation status
 * change until it was found, which is why these tests exist in this shape.
 */

const CLIENT = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

/** Builds a form the way the browser would, omitting absent fields entirely. */
function form(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

const complete = {
  clientId: CLIENT,
  enquiryDate: "2026-09-08",
  sourceId: SOURCE,
  itemDescription: "Mono carton, 300gsm SBS, 4+0 matt lamination",
  ownerUserId: OWNER,
  status: "Open",
};

describe("the enquiry form, as the browser posts it", () => {
  it("accepts a form with only the required fields filled in", () => {
    const parsed = createEnquirySchema.safeParse(parseEnquiryForm(form(complete)));

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Absent optionals arrive as undefined, never as null or "".
      expect(parsed.data.qty).toBeUndefined();
      expect(parsed.data.clientRequiredDate).toBeUndefined();
      expect(parsed.data.referredBy).toBeUndefined();
      expect(parsed.data.lostReason).toBeUndefined();
    }
  });

  it("accepts a non-Lost status even though the lost fields were never rendered", () => {
    // THE REGRESSION THIS FILE EXISTS FOR. The two lost fields are absent from
    // the FormData, and that must not refuse the save.
    for (const status of ["Open", "Quoted", "Won", "Dropped"]) {
      const parsed = createEnquirySchema.safeParse(
        parseEnquiryForm(form({ ...complete, status })),
      );
      expect(parsed.success, `${status} should parse`).toBe(true);
    }
  });

  it("refuses a Lost enquiry with no reason, and says so against that field", () => {
    const parsed = createEnquirySchema.safeParse(
      parseEnquiryForm(form({ ...complete, status: "Lost" })),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      expect(issue.path).toEqual(["lostReason"]);
      // The message has to name the consequence, not the constraint.
      expect(issue.message).toContain("why it was lost");
    }
  });

  it("accepts a Lost enquiry that gives a reason", () => {
    const parsed = createEnquirySchema.safeParse(
      parseEnquiryForm(form({ ...complete, status: "Lost", lostReason: "Price" })),
    );

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.lostReason).toBe("Price");
  });

  it("treats a blank quantity as absent rather than as zero", () => {
    // An empty text input posts "", which must not become 0 — a quantity of
    // zero is a statement, and "they did not say" is a different one.
    const parsed = createEnquirySchema.safeParse(
      parseEnquiryForm(form({ ...complete, qty: "" })),
    );

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.qty).toBeUndefined();
  });

  it("refuses a zero or negative quantity when one is actually given", () => {
    for (const qty of ["0", "-5"]) {
      const parsed = createEnquirySchema.safeParse(
        parseEnquiryForm(form({ ...complete, qty })),
      );
      expect(parsed.success, `${qty} should be refused`).toBe(false);
    }
  });

  it("refuses an enquiry with nobody to own it", () => {
    const withoutOwner = { ...complete, ownerUserId: undefined };
    const parsed = createEnquirySchema.safeParse(parseEnquiryForm(form(withoutOwner)));

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "ownerUserId")).toBe(true);
    }
  });
});

describe("the status-only change from the detail screen", () => {
  const ID = "44444444-4444-4444-8444-444444444444";

  it("carries the same lost-reason rule as the full form", () => {
    const refused = statusChangeSchema.safeParse({
      id: ID,
      status: "Lost",
      lostReason: null,
      lostNotes: null,
    });
    expect(refused.success).toBe(false);

    const accepted = statusChangeSchema.safeParse({
      id: ID,
      status: "Lost",
      lostReason: "No Response",
      lostNotes: null,
    });
    expect(accepted.success).toBe(true);
  });

  it("accepts a move to Won with both lost fields absent", () => {
    const parsed = statusChangeSchema.safeParse({
      id: ID,
      status: "Won",
      lostReason: null,
      lostNotes: null,
    });

    expect(parsed.success).toBe(true);
  });
});
