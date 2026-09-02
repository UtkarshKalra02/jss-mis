import { z } from "zod";


/**
 * Design master validation.
 *
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


  artworkUrl: optionalUrl,

  /**
   * Stage codes this design passes through. Validated against the `stage`
   * table at write time, not here — the set of stages is factory
   * configuration and lives in data (decision C3), so a list in this file
   * would go stale the moment ADMIN adds one.
   */
  processes: z.array(z.string().trim().min(1)).default([]),

  /**
   * Fabrication selections — what is DONE to this design, as distinct from the
   * stages it passes through.
   *
   * Posted as parallel arrays, one entry per TICKED option: the option's id,
   * the chosen value id (empty for a tick-only option or one whose value the
   * run decides), and the free text for FOILING → Other. Same shape as the PO
   * form's item rows and for the same reason (F20): every ticked row renders
   * every field, so index i is row i throughout, and a conditionally omitted
   * input cannot shift every later row by one.
   */
  fabricationOptionIds: z.array(z.string().trim()).default([]),
  fabricationValueIds: z.array(z.string().trim()).default([]),
  fabricationOtherTexts: z.array(z.string().trim()).default([]),
});

/** Zips the parallel arrays into selections, dropping blanks safely. */
export function fabricationSelectionsFrom(input: {
  fabricationOptionIds: string[];
  fabricationValueIds: string[];
  fabricationOtherTexts: string[];
}) {
  return input.fabricationOptionIds.map((optionId, i) => ({
    optionId,
    valueId: input.fabricationValueIds[i]?.length ? input.fabricationValueIds[i]! : null,
    otherText: input.fabricationOtherTexts[i]?.length ? input.fabricationOtherTexts[i]! : null,
  }));
}

export type DesignInput = z.infer<typeof designSchema>;

/**
 * Creating a design without leaving the PO capture form.
 *
 * Deliberately a SUBSET of designSchema, not a variant of it. The point of the
 * inline create is to unblock somebody mid-order who has a PO in front of them
 * and a design that is not in the system yet — so it asks for what is on the
 * purchase order and nothing else. Die and plate status default to NA, the
 * route is left empty (meaning the job follows the default for its type, F4),
 * and approval starts Pending.
 *
 * Everything omitted here is editable afterwards on the Design master, and the
 * dialog says so. The alternative — making the full form available in a modal —
 * would put two ways of creating a design in the app, which is one more than
 * anybody should have to keep in agreement.
 */
export const quickDesignSchema = designSchema.pick({
  clientId: true,
  jobName: true,
  jobSize: true,
  paperType: true,
  gsm: true,
});

export type QuickDesignInput = z.infer<typeof quickDesignSchema>;

