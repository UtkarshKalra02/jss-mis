import { z } from "zod";

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

export const updateRunSchema = createRunSchema.extend({
  id: z.string().uuid(),
});

export function parseRunForm(formData: FormData) {
  return createRunSchema.safeParse({
    runDate: formData.get("runDate"),
    machine: formData.get("machine"),
    notes: formData.get("notes"),
  });
}

export function parseRunUpdate(formData: FormData) {
  return updateRunSchema.safeParse({
    id: formData.get("id"),
    runDate: formData.get("runDate"),
    machine: formData.get("machine"),
    notes: formData.get("notes"),
  });
}
