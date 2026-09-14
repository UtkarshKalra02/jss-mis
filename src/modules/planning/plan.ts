import { z } from "zod";

import { formatDate } from "@/lib/format";

/**
 * The pure parts of planning a day — what the form sends, which plates move
 * as a whole, and what the screen says back. Extracted from the action for
 * the reason F25 and K22 give: these are the rules most likely to be argued
 * about, and an argument settles faster against a test than a screen.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const planSchema = z.object({
  jobCardIds: z
    .array(z.string().trim().regex(UUID, "That is not a job card."))
    .min(1, "Choose at least one job card."),
  /**
   * Blank clears the date — "take it off the plan" — which is a legitimate
   * answer at 6pm when a job that was on tomorrow's list turns out to have no
   * paper. It is NOT a removal of the card; the card goes back to the left.
   */
  plannedDate: z.union([z.literal(""), z.string().regex(ISO_DATE, "Use a real date.")]),
});

export type PlanInput = z.infer<typeof planSchema>;

/**
 * Reads the repeated `jobCardId` field and the date out of a submission.
 *
 * The same id twice is one card — a tick list cannot mean "plan it harder" —
 * so duplicates collapse before validation rather than failing it.
 */
export function parsePlanForm(formData: FormData) {
  const ids = [...new Set(formData.getAll("jobCardId").map((v) => String(v).trim()))].filter(
    Boolean,
  );
  return planSchema.safeParse({
    jobCardIds: ids,
    plannedDate: String(formData.get("plannedDate") ?? "").trim(),
  });
}

/**
 * Which plates move as a whole (L4).
 *
 * A run's own date changes only when EVERY live card on it is in the
 * selection. Moving the run because one of its three jobs was planned would
 * silently re-date two other clients' jobs — the exact accident the expansion
 * gate exists to prevent (H8). Planning one member on its own is allowed and
 * leaves the run's date alone; the board shows the disagreement rather than
 * hiding it.
 */
export function runsMovedWith(
  selected: ReadonlySet<string>,
  members: ReadonlyMap<string, readonly string[]>,
): string[] {
  const moved: string[] = [];
  for (const [runId, cards] of members) {
    if (cards.length > 0 && cards.every((id) => selected.has(id))) moved.push(runId);
  }
  return moved;
}

/** "3 job cards planned for 15 Sep 2026 · 1 plate moved with them." */
export function describePlan(input: {
  cards: number;
  plannedDate: string;
  runsMoved: number;
}): string {
  const { cards, plannedDate, runsMoved } = input;
  const noun = `${cards} job card${cards === 1 ? "" : "s"}`;

  const head =
    plannedDate === ""
      ? `${noun} taken off the plan.`
      : `${noun} planned for ${formatDate(plannedDate)}.`;

  if (runsMoved === 0) return head;

  const plates = `${runsMoved} plate${runsMoved === 1 ? "" : "s"}`;
  return `${head.slice(0, -1)} · ${plates} moved with ${cards === 1 ? "it" : "them"}.`;
}
