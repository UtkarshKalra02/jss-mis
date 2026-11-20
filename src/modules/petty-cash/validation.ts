import { z } from "zod";

import { pettyCashDirectionEnum } from "@/db/schema/enums";

/**
 * Petty cash input validation.
 *
 * Two rules carry the weight here, and both exist because a cash book that
 * accepts a plausible-looking wrong figure is worse than one that refuses it:
 *
 *   1. A head is required on the way OUT and refused on the way IN. The
 *      database says the same thing in a CHECK; this says it where the person
 *      can still fix it.
 *   2. The amount is parsed, not coerced. `Number("1,250")` is NaN and
 *      `Number("")` is 0 — one of those is a refusal and the other is a silent
 *      zero-rupee entry, so neither is left to chance.
 *
 * There is deliberately NO schema for editing an entry. CC2: an entry is added
 * or voided, never changed.
 */

/** Read off the pgEnum, so a third direction cannot appear here only (NN5). */
export const pettyCashDirections = pettyCashDirectionEnum.enumValues;
export type PettyCashDirection = (typeof pettyCashDirections)[number];

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.");

/**
 * A field the form may not have rendered at all.
 *
 * `FormData.get()` returns **null** for an absent field and zod's `.optional()`
 * permits `undefined`, not null. The head box is hidden entirely for a top-up,
 * so it is routinely absent — the exact shape of the bug that refused every
 * delegation status change, documented in that module's validation.ts.
 */
function absentOrBlank<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === null || v === "" ? undefined : v), inner.optional());
}

/**
 * The biggest single entry the tin will take: one lakh.
 *
 * Not a limit on what the factory may spend — a limit on what a TYPO can do.
 * Petty cash is tea, autos and loading; an entry two orders of magnitude out is
 * a stray keypress, and it would sit in the balance looking authoritative. A
 * genuine large payment is not petty cash and belongs in Busy.
 */
export const MAX_ENTRY_AMOUNT = 100_000;

/**
 * Rupees as typed by a person: "350", "1,250.50", " 90 ".
 *
 * Commas and spaces are stripped because people type them and refusing them
 * teaches nothing. Everything else is refused rather than guessed — two decimal
 * places at most, because paise are what the column holds and a third digit is
 * a figure somebody will later swear they did not enter.
 */
const amount = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[,\s]/g, "") : v),
  z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount in rupees, like 350 or 1250.50.")
    .refine((s) => Number(s) > 0, "An amount of zero is not a cash movement.")
    .refine(
      (s) => Number(s) <= MAX_ENTRY_AMOUNT,
      `Petty cash entries are capped at ₹${MAX_ENTRY_AMOUNT.toLocaleString("en-IN")}. Anything larger belongs in Busy.`,
    ),
);

export const addEntrySchema = z
  .object({
    entryDate: isoDate,
    direction: z.enum(pettyCashDirections),
    amount,
    /** Absent for a top-up; see the superRefine below. */
    headId: absentOrBlank(z.string().uuid("Choose what it was spent on.")),
    party: absentOrBlank(z.string().trim().max(120)),
    purpose: z
      .string()
      .trim()
      .min(3, "Say what the money was for.")
      .max(300, "Keep it short — this is one line in a cash book."),
  })
  .superRefine((v, ctx) => {
    // The same rule as the petty_cash_head_out_only CHECK, said twice on
    // purpose: here it names the box to fix, there it cannot be bypassed.
    if (v.direction === "Out" && !v.headId) {
      ctx.addIssue({
        code: "custom",
        path: ["headId"],
        message: "Choose what it was spent on.",
      });
    }
    if (v.direction === "In" && v.headId) {
      ctx.addIssue({
        code: "custom",
        path: ["headId"],
        message: "Money coming in has no head — it is a top-up, not a spend.",
      });
    }
  });

export type AddEntryInput = z.infer<typeof addEntrySchema>;

/**
 * Reads an entry out of a posted form.
 *
 * Lives here rather than in the action so the FormData contract itself is
 * testable with a real FormData — the only way the null-versus-undefined trap
 * above is ever caught, because a hand-written object is what the author
 * already believes the form posts.
 */
export function parseAddEntry(formData: FormData) {
  return addEntrySchema.safeParse({
    entryDate: formData.get("entryDate"),
    direction: formData.get("direction"),
    amount: formData.get("amount"),
    headId: formData.get("headId"),
    party: formData.get("party"),
    purpose: formData.get("purpose"),
  });
}

export const entryIdSchema = z.object({ id: z.string().uuid() });

export function parseEntryId(formData: FormData) {
  return entryIdSchema.safeParse({ id: formData.get("id") });
}

/** The sheet's date, from the query string. Falls back to today at the caller. */
export const sheetDateSchema = isoDate;
