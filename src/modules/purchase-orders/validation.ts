import { z } from "zod";

import { confirmationSourceEnum, jobTypeEnum, priorityEnum } from "@/db/schema/enums";

/**
 * PO capture validation.
 *
 * The rule this file exists to enforce is non-negotiable 6, as amended by F8:
 * committed_date is NULLABLE IN THE DATABASE and REQUIRED HERE. The column was
 * relaxed so imported historical rows can honestly say no commitment was ever
 * recorded; every human entry point still demands one, and this schema is that
 * entry point. There is no skip, no "TBC" option, and no default — a guessed
 * commitment is worse than none, because OTD is measured against it.
 *
 * If you are adding another way for a person to create a PO item, it goes
 * through this schema.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const trimmed = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()
  .refine((v) => v === undefined || /^https?:\/\/\S+$/i.test(v), {
    message: "The PO scan link must be a full URL starting with http:// or https://",
  });

/** Money arrives as a form string. Blank is legitimate — rate is optional. */
const optionalMoney = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()
  .refine((v) => v === undefined || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), {
    message: "Rate must be a number with at most two decimal places.",
  });

export const poHeaderSchema = z.object({
  clientId: z.uuid({ message: "Choose the client this PO came from." }),

  /** The client's own PO number. Optional: some arrive without one. */
  poNo: trimmed,

  poDate: z
    .string()
    .trim()
    .regex(ISO_DATE, "Enter the PO date."),

  /** Scanned PO. A pasted Drive link until file storage lands (F5). */
  fileUrl: optionalUrl,

  /**
   * Job work — the client's own material, no PO coming (section Z).
   *
   * A native checkbox posts "on" or nothing at all, which is the convention
   * the job card's checklist ticks already use. Optional here and coerced to a
   * real boolean in the action, so an absent box means false rather than
   * failing a parse.
   */
  isJobWork: z.literal("on").optional(),

  notes: trimmed,
});

export const poItemSchema = z.object({
  itemName: z
    .string()
    .trim()
    .min(1, "Every item needs a name.")
    .max(200, "Item name is too long."),

  orderedQty: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .positive("Quantity must be more than zero."),

  rate: optionalMoney,

  /**
   * NON-NEGOTIABLE 6. Required here even though the column is nullable —
   * see the note at the top of this file.
   */
  committedDate: z
    .string()
    .trim()
    .regex(ISO_DATE, "Committed date is required on every item. OTD is measured against it."),

  /** Decides which stages apply — the JOB's type, not the client's (B4). */
  jobType: z.enum(jobTypeEnum.enumValues),
  priority: z.enum(priorityEnum.enumValues),

  designId: z.union([z.uuid(), z.literal("")]).optional(),
  remarks: trimmed,
});



/* -------------------------------------------------------------------------- */
/* The confirmation (W) — asked only when an item is BORN                      */
/* -------------------------------------------------------------------------- */

/**
 * SOP Rule 1's three fields, kept OUT of poItemSchema on purpose.
 *
 * poItemSchema is shared by "add an item" and "edit an item". The
 * confirmation is a fact about the moment the job was opened, so editing an
 * item must not be able to restate it — an edit form that posted these would
 * silently rewrite when the customer confirmed every time somebody corrected
 * a quantity, and the two-hour measure would drift towards zero as rows were
 * touched. Creation extends; editing does not.
 *
 * There is deliberately no screen that corrects a confirmation yet. A typo in
 * the time is therefore permanent for now, which is a real gap and is written
 * up in DECISIONS section W rather than papered over here.
 */
export const poItemConfirmationSchema = z.object({
  /*
   * SOP RULE 1 (W). All three required, on every human entry point, for the
   * same reason committed_date is: the column is nullable so that history and
   * the importer can honestly say nothing was recorded, and this schema is
   * what makes sure nothing NEW is recorded as nothing.
   *
   * They are entered once per order on the form and posted onto every item,
   * because a PO arrives as one confirmation. Stored per item because that is
   * the grain everything else in this system is measured at, and because an
   * item added to the order next week was confirmed at a different time.
   */
  confirmationSource: z.enum(confirmationSourceEnum.enumValues, {
    message: "Say how this order was confirmed — PO, WhatsApp or verbal.",
  }),

  confirmedBy: z.uuid({
    message: "Say who took the confirmation.",
  }),

  confirmedAt: z
    .string()
    .trim()
    .regex(LOCAL_DATETIME, "Enter when the customer confirmed.")
    .refine(
      (v) => {
        /*
         * No confirmations from the future. The two-hour measure is
         * (opened − confirmed), so a date ahead of now reads as the job
         * having been opened before the customer asked for it — which the
         * SQL clamps to zero and therefore scores as perfect. Catching it
         * here means somebody sees the typo instead of the metric swallowing
         * it. Five minutes of slack for a clock that is slightly out.
         */
        const t = new Date(`${v.length === 16 ? `${v}:00` : v}+05:30`).getTime();
        return Number.isFinite(t) && t <= Date.now() + 5 * 60_000;
      },
      { message: "The confirmation time cannot be in the future." },
    ),
});

/** Everything a NEW item needs: the item, plus how it was confirmed. */
export const poItemCreateSchema = poItemSchema.extend(poItemConfirmationSchema.shape);

/**
 * Capture — the header, with the client TYPED rather than chosen (K20a).
 *
 * `poHeaderSchema` keeps `clientId` required and is still what the EDIT form
 * posts: re-assigning an existing purchase order to a different customer is a
 * choice among customers who exist, and typing a name there would let a
 * misspelling invent a client and move an order onto it in one action.
 *
 * Capture is the opposite case. Job work arrives as a party nobody has entered
 * yet — that is the whole of why PLANNER was given `client: "create"` — so the
 * form sends `clientName` always and `clientId` only when the browser's copy of
 * the client list already resolved one. The action re-matches the name against
 * live rows regardless, because that copy was loaded when the page was.
 */
export const createPoSchema = poHeaderSchema.extend({
  clientId: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.uuid().optional(),
  ),
  clientName: z
    .string()
    .trim()
    .min(2, "Say which client this order is for.")
    .max(200, "That is too long for a client name."),

  items: z.array(poItemCreateSchema).min(1, "A purchase order needs at least one item."),
});

export type PoHeaderInput = z.infer<typeof poHeaderSchema>;
export type PoItemInput = z.infer<typeof poItemSchema>;
export type PoItemCreateInput = z.infer<typeof poItemCreateSchema>;

/* -------------------------------------------------------------------------- */
/* Manual job close (section X)                                               */
/* -------------------------------------------------------------------------- */

/**
 * The reason a job was closed by hand.
 *
 * REQUIRED, and trimmed before it is measured, so a space bar does not satisfy
 * it — the database agrees via po_item_close_reason_not_blank, but a person
 * should be told by the form rather than by a constraint violation.
 *
 * The minimum is 10 characters rather than 1 deliberately. This field is the
 * entire defence against "close" becoming a way to tidy the overdue list: the
 * only thing that makes a write-off reviewable later is a sentence somebody has
 * to compose. "ok", "done" and "-" all pass a length of 1 and tell a reader
 * nothing at all.
 */
export const closeReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Say in a sentence why this job is being closed — it is read back at review.")
    .max(500, "Keep the reason under 500 characters."),
});
