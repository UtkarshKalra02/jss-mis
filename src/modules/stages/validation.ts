import { z } from "zod";

/**
 * Stage configuration validation.
 *
 * `code` is deliberately absent. Stage codes are immutable (decision C2):
 * stage_event references them by value, so changing one would rewrite the
 * history of every item that ever passed through it.
 */
export const stageRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Stage name is required.").max(60),
  sequence: z.coerce
    .number()
    .int("Sequence must be a whole number.")
    .min(0)
    .max(9999),
  isOptional: z.boolean(),
  appliesTo: z.enum(["All", "New", "Repeat"]),
  /** Blank means "no target", which is different from a target of zero. */
  targetHours: z.union([
    z.coerce.number().min(0, "Target hours cannot be negative.").max(9999),
    z.literal(""),
  ]),
  targetHoursVerified: z.boolean(),
  colour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a 6-digit hex value like #2563eb."),
  isActive: z.boolean(),
});

export type StageRowInput = z.infer<typeof stageRowSchema>;

export const atRiskWindowSchema = z.coerce
  .number()
  .int("Must be a whole number of days.")
  .min(0, "Cannot be negative.")
  .max(60, "More than 60 days would flag almost everything as at risk.");
