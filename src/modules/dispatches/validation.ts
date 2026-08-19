import { z } from "zod";

import { dispatchStatusEnum } from "@/db/schema/enums";

/**
 * Dispatch entry validation — spec 6.8, ENTRY ONLY in Phase 2.
 *
 * No challan print and no OTD dashboard here; both are Phase 3. What this
 * covers is getting real deliveries into the system, including the historical
 * ones being backfilled by hand.
 *
 * The quantity ceiling (SUM per item <= ordered_qty) is NOT checked here. It is
 * a database trigger from migration 0001, because it has to hold against any
 * writer including the importer — the action asks first only so the person gets
 * a sentence instead of a constraint violation.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const optionalMoney = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()
  .refine((v) => v === undefined || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), {
    message: "Rate must be a number with at most two decimal places.",
  });

export const dispatchHeaderSchema = z.object({
  clientId: z.uuid({ message: "Choose the client this delivery went to." }),

  /**
   * The date the goods LEFT. A business fact entered by a human, not a system
   * timestamp — which is why it dates the DISPATCHED stage event too (F3), and
   * why it must never be compared to a UTC clock without an IST cast (C10).
   */
  dispatchDate: z.string().trim().regex(ISO_DATE, "Enter the dispatch date."),

  status: z.enum(dispatchStatusEnum.enumValues),

  vehicleNo: trimmed,
  transporter: trimmed,
  ewayBillNo: trimmed,
  remarks: trimmed,
});

export const dispatchLineSchema = z.object({
  poItemId: z.uuid(),
  qty: z.coerce
    .number()
    .int("Dispatch quantity must be a whole number.")
    .positive("Dispatch quantity must be more than zero."),
  rate: optionalMoney,
});

export const createDispatchSchema = dispatchHeaderSchema.extend({
  lines: z.array(dispatchLineSchema).min(1, "Add at least one item to the challan."),
});

export type DispatchHeaderInput = z.infer<typeof dispatchHeaderSchema>;
export type DispatchLineInput = z.infer<typeof dispatchLineSchema>;
