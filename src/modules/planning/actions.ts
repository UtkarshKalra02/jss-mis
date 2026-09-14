"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedUpdate, type Actor, type Tx } from "@/db/audit";
import { jobCard, pressRun } from "@/db/schema";
import { actionError } from "@/lib/action-error";

import { describePlan, parsePlanForm, runsMovedWith } from "./plan";
import { jobCardsByIds, runMembersOf } from "./queries";

/**
 * The one write the planning board makes: a date on a job card (L1).
 *
 * NOT a second way of editing the card. Paper, plate, machine and the rest
 * stay on the card's own plan form (`updateJobCardPlanAction`), and this
 * action touches `planned_date` and nothing else — so a person planning at 6pm
 * cannot post a stale copy of the card's spec back over a correction somebody
 * made at 4pm, which is J6's reasoning applied to a different pair of forms.
 *
 * Gated on `job_planning`, not `job_card`. The two are separate resources so
 * that raising a card does not hand somebody the board (J2), and ACCOUNTS —
 * who raises cards (K11) — is the role that difference is for.
 */

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
};

const ok = (message?: string): FormState => ({ ok: true, error: null, message });
const fail = (error: string): FormState => ({ ok: false, error });

async function requirePlanner(): Promise<Actor> {
  const user = await requireAccess("job_planning", "write");
  return { id: user.id, role: user.role };
}

/**
 * Plans, re-plans or un-plans a set of job cards for one day.
 *
 * REFUSES a completed or cancelled card outright. Neither has a day ahead of
 * it, and a planned date on one would put finished work on tomorrow's floor
 * plan. The message names the card, because the board only ever shows open
 * cards and a stale tab is the way this arises.
 *
 * A WHOLE PLATE MOVES WITH ITS CARDS (L4). When every live card on a press run
 * is in the selection, the run's own date is written to match, in the same
 * transaction — a run dated Tuesday whose three cards all say Wednesday is a
 * sheet that disagrees with itself. When only some of them are selected the
 * run's date is left alone and the board shows the gap. Clearing dates never
 * touches the run: `run_date` is NOT NULL, and "not planned" is a statement
 * about the cards, not the plate.
 */
export async function planCardsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePlanner();

    const parsed = parsePlanForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const { jobCardIds, plannedDate } = parsed.data;

    const cards = await jobCardsByIds(jobCardIds);
    if (cards.length !== jobCardIds.length) {
      return fail(
        `${jobCardIds.length - cards.length} of those job cards ${jobCardIds.length - cards.length === 1 ? "is" : "are"} no longer in the system. Reload the board and choose again.`,
      );
    }

    const finished = cards.find((c) => c.status === "Completed" || c.status === "Cancelled");
    if (finished) {
      return fail(
        `${finished.jcNo} is ${finished.status.toLowerCase()} and has no day ahead of it. Reload the board.`,
      );
    }

    const selected = new Set(cards.map((c) => c.id));
    const members = await runMembersOf(jobCardIds);
    const runsToMove = plannedDate === "" ? [] : runsMovedWith(selected, members);

    await db.transaction(async (tx: Tx) => {
      for (const card of cards) {
        await auditedUpdate(
          actor,
          jobCard,
          card.id,
          { plannedDate: plannedDate === "" ? null : plannedDate },
          tx,
        );
      }
      for (const runId of runsToMove) {
        await auditedUpdate(actor, pressRun, runId, { runDate: plannedDate }, tx);
      }
    });

    revalidatePath("/planning");
    revalidatePath("/job-cards");
    for (const card of cards) revalidatePath(`/job-cards/${card.id}`);
    for (const runId of runsToMove) revalidatePath(`/press-runs/${runId}`);

    return ok(describePlan({ cards: cards.length, plannedDate, runsMoved: runsToMove.length }));
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save the plan."));
  }
}
