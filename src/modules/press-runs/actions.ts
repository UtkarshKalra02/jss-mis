"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor } from "@/db/audit";
import { jobCard, pressRun } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";

import { getJobCard, getPressRun, getRunMembers } from "./queries";
import { parseRunForm, parseRunUpdate } from "./validation";

/**
 * Press run writes (ganging).
 *
 * What is NOT here is as deliberate as what is (decision H2):
 *
 *   - no cost splitting. The allocation rule — by ups, by area, by quantity —
 *     is unknown, and picking one here would be inventing a number rather than
 *     discovering it. It belongs with the costing engine, which is not in v1.
 *   - no scheduling or capacity. Phase 4, and it needs machine timings that do
 *     not exist.
 *   - no rule that ganged cards share a stage or move together. They diverge
 *     legitimately the moment they come off the press — one to lamination, one
 *     straight to die-cut.
 *
 * And there is no cross-client check anywhere in this file, which is the point
 * of the feature rather than an omission (H3).
 */

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  /** Set when the action makes the current page unreachable (G11). */
  redirectTo?: string;
};

const ok = (message?: string, redirectTo?: string): FormState => ({
  ok: true,
  error: null,
  message,
  redirectTo,
});
const fail = (error: string): FormState => ({ ok: false, error });

/**
 * Where to send somebody after removing the row the page was showing.
 *
 * A SERVER REDIRECT, not a destination returned to the client (J13). The
 * earlier fix returned `redirectTo` and let a useEffect push to it, and that
 * loses a race it cannot win: a server action re-renders the current route
 * before the client effect commits, the page calls notFound() against a row
 * that has just gone, and the confirmation for removing something is a 404.
 * Returning the destination only made the 404 shorter.
 *
 * `redirect()` works by throwing, which is why G11 avoided it — every one of
 * these actions has a try/catch that would report the successful removal as a
 * failure. `unstable_rethrow` in the catch is the answer to that: it lets
 * Next's own control-flow errors through and leaves real errors to be handled.
 *
 * The message rides in the query string, and the app shell turns it into a
 * toast, so the confirmation survives the navigation.
 */
function removedTo(path: string, message: string): never {
  redirect(`${path}?removed=${encodeURIComponent(message)}`);
}

/** ADMIN and PLANNER build press runs. Everyone else can only look (H6). */
async function requireRunWriter(): Promise<Actor> {
  const user = await requireAccess("press_run", "write");
  return { id: user.id, role: user.role };
}

function revalidate(runId?: string, poItemId?: string) {
  if (runId) revalidatePath(`/press-runs/${runId}`);
  if (poItemId) revalidatePath(`/items/${poItemId}`);
  revalidatePath("/items");
}

/* -------------------------------------------------------------------------- */
/* Create a run, with the job card that prompted it                            */
/* -------------------------------------------------------------------------- */

/**
 * Starts a press run and puts one job card in it.
 *
 * The two happen together, in one transaction, because a run with no job cards
 * is not a thing that happened — it is a number somebody allocated and then
 * abandoned. Creating them as one action means the first member is always
 * there, and it is also what C7 requires of the allocator: `allocateNumber`
 * takes the transaction that creates the row it numbers, so a failed insert
 * rolls the number back rather than burning it.
 *
 * The run's DATE decides the financial year of its number (F10), not today —
 * a run back-dated to March belongs to the previous year's series.
 */
export async function createRunForJobCardAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRunWriter();

    const jobCardId = String(formData.get("jobCardId") ?? "");
    const parsed = parseRunForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const card = await getJobCard(jobCardId);
    if (!card) return fail("That job card no longer exists.");
    if (card.pressRunId) {
      return fail("That job card is already in a press run. Remove it from that one first.");
    }

    const run = await db.transaction(async (tx) => {
      const created = await auditedInsert(
        actor,
        pressRun,
        {
          runNo: await allocateNumber(tx, "PR", v.runDate),
          runDate: v.runDate,
          machine: v.machine ?? null,
          notes: v.notes ?? null,
        },
        tx,
      );

      await auditedUpdate(actor, jobCard, jobCardId, { pressRunId: created.id }, tx);
      return created;
    });

    revalidate(run.id, card.poItemId);
    return ok(`${run.runNo} started, with ${card.jcNo} on it.`, `/press-runs/${run.id}`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not start that press run.");
  }
}

/* -------------------------------------------------------------------------- */
/* Add and remove members                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Puts an existing job card on an existing run.
 *
 * Refuses only one thing: a card already on another run. That is a genuine
 * ambiguity — a job card is printed once — rather than a policy, and the fix is
 * to take it off the first run, which the person can see and do.
 *
 * It does NOT refuse a different client, a different stage, or a different
 * planned date. All three are normal on a gang (H3).
 */
export async function addJobCardToRunAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRunWriter();

    const jobCardId = String(formData.get("jobCardId") ?? "");
    const pressRunId = String(formData.get("pressRunId") ?? "");

    const [card, run] = await Promise.all([getJobCard(jobCardId), getPressRun(pressRunId)]);
    if (!card) return fail("That job card no longer exists.");
    if (!run) return fail("That press run no longer exists.");

    if (card.pressRunId === pressRunId) return fail(`${card.jcNo} is already on ${run.runNo}.`);
    if (card.pressRunId) {
      return fail("That job card is already in another press run. Remove it from that one first.");
    }

    await auditedUpdate(actor, jobCard, jobCardId, { pressRunId });

    revalidate(pressRunId, card.poItemId);
    return ok(`${card.jcNo} added to ${run.runNo}.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not add it to that run.");
  }
}

/**
 * Takes a job card off a run.
 *
 * Sets press_run_id back to null, which is the same state as every job card
 * that was never ganged — so removal is a return to the ordinary case rather
 * than a special one. The run itself survives even when emptied: it was
 * allocated a number and that number was real.
 */
export async function removeJobCardFromRunAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRunWriter();
    const jobCardId = String(formData.get("jobCardId") ?? "");

    const card = await getJobCard(jobCardId);
    if (!card) return fail("That job card no longer exists.");
    if (!card.pressRunId) return fail("That job card is not on a press run.");

    const runId = card.pressRunId;
    await auditedUpdate(actor, jobCard, jobCardId, { pressRunId: null });

    revalidate(runId, card.poItemId);
    return ok(`${card.jcNo} removed from the run.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not remove it from the run.");
  }
}

/* -------------------------------------------------------------------------- */
/* Edit and remove the run itself                                              */
/* -------------------------------------------------------------------------- */

export async function updateRunAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRunWriter();

    const parsed = parseRunUpdate(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const run = await getPressRun(v.id);
    if (!run) return fail("That press run no longer exists.");

    // The run NUMBER is not re-allocated when the date moves. It was issued,
    // it may already be written on a plate bag, and renumbering documents
    // after the fact is how two pieces of paper end up disagreeing (C7).
    await auditedUpdate(actor, pressRun, v.id, {
      runDate: v.runDate,
      machine: v.machine ?? null,
      notes: v.notes ?? null,
    });

    revalidate(v.id);
    return ok("Run updated.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not update that run.");
  }
}

/**
 * Soft-deletes a run.
 *
 * Refused while job cards are still on it. Removing the run underneath them
 * would leave those cards pointing at a row nothing displays — the same shape
 * of orphan the import's undo is careful to avoid (F31) — and it is a
 * one-click way to lose the record that a plate was shared. Empty it first,
 * which is a deliberate act per card.
 */
export async function removeRunAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireRunWriter();
    const id = String(formData.get("id") ?? "");

    const run = await getPressRun(id);
    if (!run) return fail("That press run no longer exists.");

    const members = await getRunMembers(id);
    if (members.length > 0) {
      return fail(
        `${run.runNo} still has ${members.length} job card${members.length === 1 ? "" : "s"} on it. Take them off first.`,
      );
    }

    await auditedSoftDelete(actor, pressRun, id);

    revalidate(id);
    removedTo("/items", `${run.runNo} removed.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not remove that run.");
  }
}
