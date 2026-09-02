import { z } from "zod";

import { supplyByEnum } from "@/db/schema/enums";

/**
 * Job card form contracts.
 *
 * TWO SEPARATE SCHEMAS, deliberately, because they are filled in by different
 * people at different times and one must never overwrite the other.
 *
 * `releaseSchema` is the plan: what is going to run, on what machine, with
 * whose paper and whose plate. It is typed before the card is printed.
 *
 * `executionSchema` is what actually happened: the final quantity, the
 * wastage, and a note. Those three are written by hand on the printed sheet on
 * the floor and transcribed afterwards (J4). Folding them into one schema
 * would mean a transcription posts the whole card back, and a stale plan field
 * in that submission would silently overwrite a corrected one.
 */

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.");

/**
 * Absent and blank both mean "not given".
 *
 * `FormData.get()` returns null for a field the form did not render, and zod's
 * `.optional()` permits undefined rather than null — the mismatch that broke
 * every save on the delegation status form (G10). Everything optional read out
 * of a FormData goes through here.
 */
function absentOrBlank<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === null || v === "" ? undefined : v), inner.optional());
}

export const supplyByValues = supplyByEnum.enumValues;

export const releaseSchema = z.object({
  poItemId: z.uuid("Choose an item."),

  /**
   * Nullable in the database and optional here. Phase 4's planning board is
   * what schedules a day; releasing a card before then is legitimate and says
   * only that the job may go to the floor.
   */
  plannedDate: absentOrBlank(isoDate),

  plannedQty: absentOrBlank(
    z.coerce
      .number()
      .int("Quantity must be a whole number.")
      .positive("Quantity must be more than zero.")
      .max(99_999_999),
  ),

  paperSupplyBy: absentOrBlank(z.enum(supplyByValues)),
  plateSupplyBy: absentOrBlank(z.enum(supplyByValues)),
  plateJobId: absentOrBlank(z.string().trim().max(120)),
  machineDetail: absentOrBlank(z.string().trim().max(200)),
  notes: absentOrBlank(z.string().trim().max(1000)),

  /**
   * The second-card acknowledgement (J3).
   *
   * A repeat or split run is legitimate — spec section 3 says a PO item may
   * have several job cards — so a second release warns rather than blocks. It
   * rides on the button's own name/value rather than a state-driven hidden
   * input, for the reason F20 found on the PO form: a click submits before
   * React re-renders, so a state-driven flag arrives one submit late and the
   * form asks the same question twice.
   */
  confirmSecondCard: absentOrBlank(z.literal("1")),
});

export type ReleaseInput = z.infer<typeof releaseSchema>;

export function parseReleaseForm(formData: FormData) {
  return releaseSchema.safeParse({
    poItemId: formData.get("poItemId"),
    plannedDate: formData.get("plannedDate"),
    plannedQty: formData.get("plannedQty"),
    paperSupplyBy: formData.get("paperSupplyBy"),
    plateSupplyBy: formData.get("plateSupplyBy"),
    plateJobId: formData.get("plateJobId"),
    machineDetail: formData.get("machineDetail"),
    notes: formData.get("notes"),
    confirmSecondCard: formData.get("confirmSecondCard"),
  });
}

/**
 * The three fields transcribed back off the paper card after the run.
 *
 * `finalQty` is not capped against `plannedQty`. An over-run is ordinary on a
 * press, and a rule refusing the true number would be answered by typing a
 * false one — the same reasoning that made the duplicate PO number a warning
 * rather than a constraint (F7).
 */
export const executionSchema = z.object({
  id: z.uuid(),

  finalQty: absentOrBlank(
    z.coerce
      .number()
      .int("Final quantity must be a whole number.")
      .min(0, "Final quantity cannot be negative.")
      .max(99_999_999),
  ),

  wastageQty: absentOrBlank(
    z.coerce
      .number()
      .int("Wastage must be a whole number.")
      .min(0, "Wastage cannot be negative.")
      .max(99_999_999),
  ),

  executionRemarks: absentOrBlank(z.string().trim().max(1000)),
});

export type ExecutionInput = z.infer<typeof executionSchema>;

export function parseExecutionForm(formData: FormData) {
  return executionSchema.safeParse({
    id: formData.get("id"),
    finalQty: formData.get("finalQty"),
    wastageQty: formData.get("wastageQty"),
    executionRemarks: formData.get("executionRemarks"),
  });
}
