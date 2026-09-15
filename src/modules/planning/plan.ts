import { z } from "zod";

import { formatDate } from "@/lib/format";

/**
 * The pure parts of planning a day — what the forms send, how a queue is
 * re-ordered, and what the screen says back. Extracted from the actions for
 * the reason F25 and K22 give: these are the rules most likely to be argued
 * about, and an argument settles faster against a test than a screen.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PLAN_KINDS = ["Production", "Dispatch"] as const;

export const addSchema = z
  .object({
    poItemIds: z
      .array(z.string().trim().regex(UUID, "That is not an item."))
      .min(1, "Tick at least one item."),
    planDate: z.string().regex(ISO_DATE, "Use a real date."),
    kind: z.enum(PLAN_KINDS),
    /** Required for Production, ignored for Dispatch (M2). */
    stageCode: z.string().trim().max(60),
    machineId: z.union([z.literal(""), z.string().regex(UUID)]),
  })
  .refine((v) => v.kind === "Dispatch" || v.stageCode !== "", {
    message: "Choose the station the job goes to.",
    path: ["stageCode"],
  });

export type AddInput = z.infer<typeof addSchema>;

/** Reads the repeated `poItemId` field and the rest; duplicate ticks collapse. */
export function parseAddForm(formData: FormData) {
  const ids = [...new Set(formData.getAll("poItemId").map((v) => String(v).trim()))].filter(
    Boolean,
  );
  return addSchema.safeParse({
    poItemIds: ids,
    planDate: String(formData.get("planDate") ?? "").trim(),
    kind: String(formData.get("kind") ?? ""),
    stageCode: String(formData.get("stageCode") ?? ""),
    machineId: String(formData.get("machineId") ?? "").trim(),
  });
}

export const entrySchema = z.object({ entryId: z.string().regex(UUID, "That is not a plan line.") });

export const MOVES = ["up", "down", "first", "last"] as const;
export type Move = (typeof MOVES)[number];

export const moveSchema = entrySchema.extend({ direction: z.enum(MOVES) });

export const pushSchema = entrySchema.extend({
  toDate: z.string().regex(ISO_DATE, "Use a real date."),
});

export const qtySchema = entrySchema.extend({
  plannedQty: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .positive("Quantity must be more than zero.")
    .max(99_999_999),
});

/**
 * Re-orders a queue by moving one id (M2).
 *
 * Returns the ids in their new order. An id not in the list, or a move that
 * changes nothing (up from the top), returns the list unchanged — the caller
 * writes only what differs, so a no-op writes nothing.
 */
export function reorder(ids: readonly string[], id: string, direction: Move): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];

  const to =
    direction === "first"
      ? 0
      : direction === "last"
        ? ids.length - 1
        : direction === "up"
          ? Math.max(0, from - 1)
          : Math.min(ids.length - 1, from + 1);

  if (to === from) return [...ids];

  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Which positions changed between two orderings, as id → new position.
 * Positions are 1-based so a fresh day reads 1, 2, 3 on the sheet.
 */
export function changedPositions(
  before: readonly string[],
  after: readonly string[],
): Map<string, number> {
  const changes = new Map<string, number>();
  after.forEach((id, index) => {
    if (before[index] !== id) changes.set(id, index + 1);
  });
  return changes;
}

/** "3 items added to Tuesday's production plan · 1 was already there." */
export function describeAdd(input: {
  added: number;
  skipped: number;
  kind: (typeof PLAN_KINDS)[number];
  planDate: string;
}): string {
  const { added, skipped, kind, planDate } = input;
  const list = kind === "Dispatch" ? "dispatch list" : "production plan";
  const head =
    added === 0
      ? `Nothing added to the ${formatDate(planDate)} ${list}`
      : `${added} item${added === 1 ? "" : "s"} added to the ${formatDate(planDate)} ${list}`;
  const tail =
    skipped === 0 ? "" : ` · ${skipped} ${skipped === 1 ? "was" : "were"} already on it`;
  return `${head}${tail}.`;
}
