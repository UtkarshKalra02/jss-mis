import { z } from "zod";

import { paperBundleEnum } from "@/db/schema/enums";

/**
 * Press run input validation.
 *
 * Small on purpose. A press run is a number, a date, a machine note and a set
 * of job cards — there is no cost split and no schedule to validate, because
 * both are deliberately out of scope (H2).
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.");

/**
 * Absent and blank both mean "not given".
 *
 * `FormData.get()` returns null for a field the form did not render, and zod's
 * .optional() permits undefined rather than null — the distinction that broke
 * every save on the delegation status form (G10). Everything optional read out
 * of a FormData in this module goes through here.
 */
function absentOrBlank<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === null || v === "" ? undefined : v), inner.optional());
}

export const createRunSchema = z.object({
  runDate: isoDate,
  machine: absentOrBlank(z.string().trim().max(120)),
  notes: absentOrBlank(z.string().trim().max(500)),
});

/**
 * The sheet, entered once for the whole plate (J15).
 *
 * The same fields a standalone job card carries, on the run instead — because
 * a ganged run has ONE parent sheet, one plate and one supply arrangement, and
 * holding them per card would let two cards on one plate disagree.
 *
 * The run figures are separate below, for the same reason the job card's are
 * (J6): they are transcribed after the run by somebody who must not post a
 * stale copy of the plan back with them.
 */
export const runSheetSchema = z.object({
  id: z.uuid(),
  runDate: isoDate,
  machineId: absentOrBlank(z.uuid()),
  notes: absentOrBlank(z.string().trim().max(500)),

  paperSize: absentOrBlank(z.string().trim().max(120)),
  paperGsm: absentOrBlank(z.string().trim().max(60)),
  paperFinish: absentOrBlank(z.string().trim().max(60)),
  /** Bundles and what they are, the same pair the card carries (J18). */
  paperQty: absentOrBlank(
    z.coerce
      .number()
      .int("Quantity must be a whole number of bundles.")
      .positive("Quantity must be more than zero.")
      .max(9_999_999),
  ),
  paperBundle: absentOrBlank(z.enum(paperBundleEnum.enumValues)),
  paperParts: absentOrBlank(
    z.coerce
      .number()
      .int("Parts must be a whole number.")
      .positive("Parts must be at least one.")
      .max(1_000),
  ),

  paperRemarks: absentOrBlank(z.string().trim().max(500)),

  plateJobId: absentOrBlank(z.string().trim().max(120)),
  paperSupplyBy: absentOrBlank(z.enum(["Press", "Party"])),
  plateSupplyBy: absentOrBlank(z.enum(["Press", "Party"])),
});

export function parseRunSheet(formData: FormData) {
  // Same pairing rule as the card's (J18): a quantity with no bundle is not a
  // fact, and the check constraint refuses it either way.
  return runSheetSchema
    .superRefine((v, ctx) => {
      if (v.paperQty !== undefined && v.paperBundle === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["paperBundle"],
          message:
            "Choose packet, ream or gross — a quantity on its own does not say how much paper.",
        });
      }
    })
    .safeParse({
    id: formData.get("id"),
    runDate: formData.get("runDate"),
    machineId: formData.get("machineId"),
    notes: formData.get("notes"),
    paperSize: formData.get("paperSize"),
    paperGsm: formData.get("paperGsm"),
    paperFinish: formData.get("paperFinish"),
    paperQty: formData.get("paperQty"),
    paperBundle: formData.get("paperBundle"),
    paperParts: formData.get("paperParts"),
    paperRemarks: formData.get("paperRemarks"),
    plateJobId: formData.get("plateJobId"),
    paperSupplyBy: formData.get("paperSupplyBy"),
    plateSupplyBy: formData.get("plateSupplyBy"),
  });
}

/**
 * What came off the plate — ONE set for the whole run.
 *
 * The press produced a number of sheets; how that divides between the clients
 * on it is a separate question that often does not need answering. Where it
 * does, the run sheet leaves space to write the split by hand and the remark
 * is where it gets typed.
 */
export const runExecutionSchema = z.object({
  id: z.uuid(),
  finalQty: absentOrBlank(
    z.coerce.number().int().min(0, "Final quantity cannot be negative.").max(99_999_999),
  ),
  wastageQty: absentOrBlank(
    z.coerce.number().int().min(0, "Wastage cannot be negative.").max(99_999_999),
  ),
  executionRemarks: absentOrBlank(z.string().trim().max(2000)),
});

export function parseRunExecution(formData: FormData) {
  return runExecutionSchema.safeParse({
    id: formData.get("id"),
    finalQty: formData.get("finalQty"),
    wastageQty: formData.get("wastageQty"),
    executionRemarks: formData.get("executionRemarks"),
  });
}


export function parseRunForm(formData: FormData) {
  return createRunSchema.safeParse({
    runDate: formData.get("runDate"),
    machine: formData.get("machine"),
    notes: formData.get("notes"),
  });
}

