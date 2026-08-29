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
  completedAt: z.union([isoDate, z.literal("")]).optional(),
  blockerNote: z.union([z.string().trim().max(500), z.literal("")]).optional(),
});

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
