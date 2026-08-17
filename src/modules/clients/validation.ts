import { z } from "zod";

/**
 * Client master validation.
 *
 * The rule worth knowing: only `code` and `name` are required. Everything else
 * is genuinely optional, because a PO often arrives before anyone has the
 * GSTIN or the billing address, and a form that refuses to save until every
 * field is filled just gets worked around with placeholder junk.
 */

/** Short internal reference, e.g. NAT, MUL. Uppercase so lists sort sanely. */
export const clientCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Code must be at least 2 characters.")
  .max(12, "Code must be 12 characters or fewer.")
  .regex(/^[A-Z0-9-]+$/, "Code can contain only letters, numbers and hyphens.");

/**
 * 15 characters: 2 state digits, 10-char PAN, entity digit, 'Z', checksum.
 * Validated loosely — the format is checked, the checksum is not, because
 * rejecting a real GSTIN over a checksum quirk is worse than storing one that
 * Busy will catch anyway.
 */
const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/,
    "That does not look like a valid 15-character GSTIN.",
  );

const optionalText = (max = 200) =>
  z.union([z.string().trim().max(max), z.literal("")]).optional();

export const clientSchema = z.object({
  code: clientCodeSchema,
  name: z.string().trim().min(1, "Name is required.").max(200),

  gstin: z.union([gstinSchema, z.literal("")]).optional(),

  addressLine1: optionalText(),
  addressLine2: optionalText(),
  city: optionalText(80),
  state: optionalText(80),
  pincode: z
    .union([z.string().trim().regex(/^[1-9][0-9]{5}$/, "Pincode must be 6 digits."), z.literal("")])
    .optional(),

  contactName: optionalText(120),
  contactPhone: z
    .union([
      z
        .string()
        .trim()
        .regex(/^[0-9+\-\s()]{6,20}$/, "That does not look like a phone number."),
      z.literal(""),
    ])
    .optional(),
  contactEmail: z
    .union([z.string().trim().email("Enter a valid email address."), z.literal("")])
    .optional(),

  paymentTermsDays: z.coerce
    .number()
    .int("Payment terms must be a whole number of days.")
    .min(0, "Payment terms cannot be negative.")
    .max(365, "Payment terms cannot exceed 365 days."),

  // Credit limit is a warning threshold, never a block (spec 4.1), so an empty
  // value is meaningful: it means "no limit set", not "limit of zero".
  creditLimit: z
    .union([z.coerce.number().min(0, "Credit limit cannot be negative."), z.literal("")])
    .optional(),

  clientType: z.enum(["New", "Repeat"]),
});

export type ClientInput = z.infer<typeof clientSchema>;
