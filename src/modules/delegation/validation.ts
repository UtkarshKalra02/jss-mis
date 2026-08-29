import { z } from "zod";

/**
 * Delegation input validation.
 *
 * The rule worth knowing is that `expectedDate` is required everywhere and has
 * no "not sure yet" path. A task without a date is not a delegated task, it is
 * a wish — and the whole module exists to produce a number that depends on
 * there being a date to be late against.
 *
 * There is deliberately NO recurrence field to validate (decision G5).
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.");

/**
 * A field the form may not have rendered at all.
 *
 * `FormData.get()` returns **null** for an absent field, and zod's `.optional()`
 * permits `undefined` — not null. The two are not interchangeable at this
 * boundary, and getting it wrong is silent in the worst way: the schema refuses
 * the whole payload with "Invalid input" against a field the person never saw,
 * so the save fails and the message names something that is not on their screen.
 *
 * That is exactly what happened to the status form, whose completion date is
 * rendered only for Done and whose blocker note is rendered only for Blocked —
 * so at least one of the two was always absent, and EVERY status change was
 * refused. Anything reading an optional value out of a FormData goes through
 * here.
 */
function absentOrBlank<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === null || v === "" ? undefined : v), inner.optional());
}

export const delegationLevels = ["L2", "L3", "L4"] as const;

export const delegationStatuses = [
  "Not Started",
  "In Progress",
  "Done",
  "Blocked",
  "Cancelled",
] as const;

export const createTaskSchema = z.object({
  assignedTo: z.string().uuid("Choose who this is for."),

  task: z
    .string()
    .trim()
    .min(3, "Say what the task is.")
    .max(500, "Keep it to 500 characters — this is one task, not a project."),

  expectedDate: isoDate,

  level: z.enum(delegationLevels),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** What the ASSIGNEE may post. Note the absence of task and expectedDate. */
export const statusPatchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(delegationStatuses),
  // Both are conditionally rendered, so both are routinely absent. See
  // absentOrBlank — this is where the status form was silently broken.
  completedAt: absentOrBlank(isoDate),
  blockerNote: absentOrBlank(z.string().trim().max(500)),
});

/**
 * Reads a status change out of a posted form.
 *
 * Lives here rather than in the action so the FormData contract can be tested
 * with a real FormData — which is the only way the null-versus-undefined bug
 * above was ever going to be caught. Testing the schema against a hand-written
 * object cannot find it, because a hand-written object is what the author
 * already believes the form posts.
 */
export function parseStatusPatch(formData: FormData) {
  return statusPatchSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    completedAt: formData.get("completedAt"),
    blockerNote: formData.get("blockerNote"),
  });
}

/** What the DELEGATOR may post. Note the absence of status. */
export const definitionPatchSchema = z.object({
  id: z.string().uuid(),
  task: z.string().trim().min(3, "Say what the task is.").max(500),
  expectedDate: isoDate,
  level: z.enum(delegationLevels),
});

export const reassignSchema = z.object({
  id: z.string().uuid(),
  assignedTo: z.string().uuid("Choose who this is for."),
});
