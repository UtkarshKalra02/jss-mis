import { z } from "zod";

import { dieplateStatusEnum } from "@/db/schema/enums";

/**
 * Design master validation.
 *
 * The status lists come from `dieplateStatusEnum.enumValues` rather than being
 * retyped here — non-negotiable 5, "TypeScript enums are generated from the
 * schema". Adding a value to the Postgres enum makes it valid here and appear
 * in the form with no second edit, and removing one is a compile error rather
 * than a value that quietly still validates.
 *
 * approval_status is deliberately NOT in this schema. Approval is an action
 * with a timestamp and an approver attached (spec 6.5), not a dropdown on a
 * form somebody might change while editing a paper size.
 */

const trimmed = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

/**
 * Artwork lives in Drive for now (decision F5) and this column holds a pasted
 * link. Requiring a real URL keeps it from filling up with "on Punit's
 * desktop", which is not a location anybody else can open.
 */
const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()
  .refine((v) => v === undefined || /^https?:\/\/\S+$/i.test(v), {
    message: "Artwork link must be a full URL starting with http:// or https://",
  });

export const designSchema = z.object({
  clientId: z.uuid({ message: "Choose the client this design belongs to." }),

  jobName: z
    .string()
    .trim()
    .min(1, "Job name is required.")
    .max(200, "Job name is too long."),

  jobSize: trimmed,
  gsm: trimmed,
  paperType: trimmed,
  printType: trimmed,
  noOfColours: trimmed,

  dieId: trimmed,
  plateId: trimmed,
  dieStatus: z.enum(dieplateStatusEnum.enumValues),
  plateStatus: z.enum(dieplateStatusEnum.enumValues),

  artworkUrl: optionalUrl,

  /**
   * Stage codes this design passes through. Validated against the `stage`
   * table at write time, not here — the set of stages is factory
   * configuration and lives in data (decision C3), so a list in this file
   * would go stale the moment ADMIN adds one.
   */
  processes: z.array(z.string().trim().min(1)).default([]),
});

export type DesignInput = z.infer<typeof designSchema>;
