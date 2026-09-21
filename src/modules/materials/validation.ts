import { z } from "zod";

import {
  materialAdjustmentReasonEnum,
  materialReorderMethodEnum,
  materialReorderNoteEnum,
  materialUnitEnum,
} from "@/db/schema/enums";

/**
 * Store validation (section O).
 *
 * Quantities are numeric(12,2) in the database — kilos and litres are
 * fractional — and arrive as form strings. A blank optional figure becomes
 * undefined, never 0: "no consumption rate recorded" and "consumes nothing"
 * are different facts and the stock view treats them differently.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The three things the In/Out log can show (P4). Here, not in queries.ts,
 * because the log's filter is a client component and must not pull the
 * database module into the browser bundle.
 */
export const MOVEMENT_KINDS = ["In", "Out", "Adjustment"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

const trimmed = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const optionalQty = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()
  .refine((v) => v === undefined || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), {
    message: "Must be a number with at most two decimal places.",
  });

const optionalInt = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()
  .refine((v) => v === undefined || /^\d+$/.test(v), { message: "Must be a whole number." })
  .transform((v) => (v === undefined ? undefined : Number(v)));

const requiredQty = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a quantity with at most two decimal places.")
  .refine((v) => Number(v) > 0, { message: "Quantity must be more than zero." });

const optionalUrl = trimmed.refine((v) => v === undefined || /^https?:\/\/\S+$/i.test(v), {
  message: "The scan link must be a full URL starting with http:// or https://",
});

export const materialSchema = z.object({
  name: z.string().trim().min(1, "Every material needs a name.").max(200, "Name is too long."),
  categoryId: z.uuid({ message: "Choose a category." }),
  typeId: z.uuid({ message: "Choose a material type." }),
  size: trimmed,
  gsm: optionalInt,
  colour: trimmed,
  finish: trimmed,
  unit: z.enum(materialUnitEnum.enumValues, { message: "Choose the unit it is counted in." }),
  isActive: z.boolean().default(true),
  reorderMethod: z.enum(materialReorderMethodEnum.enumValues),
  leadTimeDays: optionalInt,
  minOrderQty: optionalQty,
  safetyFactor: optionalQty,
  issueIntervalDays: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional()
    .refine((v) => v === undefined || (/^\d+(\.\d)?$/.test(v) && Number(v) > 0), {
      message: "Issue interval must be a number of days, more than zero.",
    }),
  inTransitQty: optionalQty,
  reorderNote: z.union([z.enum(materialReorderNoteEnum.enumValues), z.literal("")]).optional(),
  imageUrl: optionalUrl,
  remarks: trimmed,
});

export const grnLineSchema = z.object({
  materialId: z.uuid({ message: "Choose the material." }),
  qty: requiredQty,
  /** Paper bought for a particular job (P3). */
  jobRef: trimmed,
  remarks: trimmed,
});

export const grnSchema = z.object({
  receivedDate: z.string().trim().regex(ISO_DATE, "Enter the date the goods arrived."),
  vendor: z.string().trim().min(1, "Who supplied it?").max(200, "Vendor name is too long."),
  invoiceNo: trimmed,
  invoiceUrl: optionalUrl,
  remarks: trimmed,
  lines: z.array(grnLineSchema).min(1, "A receipt needs at least one line."),
});

export const issueSchema = z.object({
  batchId: z.uuid({ message: "Choose the batch it comes from." }),
  issuedOn: z.string().trim().regex(ISO_DATE, "Enter the date it was issued."),
  qty: requiredQty,
  department: trimmed,
  jobCardId: z.union([z.uuid(), z.literal("")]).optional(),
  /** The job by name — for work with no card, as the ledger always had it. */
  jobRef: trimmed,
  remarks: trimmed,
});

export const adjustmentSchema = z.object({
  batchId: z.uuid({ message: "Choose the batch to adjust." }),
  adjustedOn: z.string().trim().regex(ISO_DATE, "Enter the date of the count."),
  /** Signed. "-10" takes ten away. Zero is refused by the database too. */
  qty: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,2})?$/, "Enter a quantity, negative to take stock away.")
    .refine((v) => Number(v) !== 0, { message: "An adjustment of zero changes nothing." }),
  reason: z.enum(materialAdjustmentReasonEnum.enumValues, { message: "Choose a reason." }),
  remarks: trimmed,
});

export type MaterialInput = z.infer<typeof materialSchema>;
export type GrnInput = z.infer<typeof grnSchema>;
export type IssueInput = z.infer<typeof issueSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
