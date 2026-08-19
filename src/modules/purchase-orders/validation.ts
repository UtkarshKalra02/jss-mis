import { z } from "zod";

import { jobTypeEnum, priorityEnum } from "@/db/schema/enums";

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

export const createPoSchema = poHeaderSchema.extend({
  items: z.array(poItemSchema).min(1, "A purchase order needs at least one item."),
});

export type PoHeaderInput = z.infer<typeof poHeaderSchema>;
export type PoItemInput = z.infer<typeof poItemSchema>;
