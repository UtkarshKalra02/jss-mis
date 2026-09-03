"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor } from "@/db/audit";
import { jobCard, pressRun } from "@/db/schema";
import { allocateNumber, todayIST } from "@/lib/numbering";

import { syncJobCardFabrication } from "@/modules/fabrication/write";
import { getPressRun as getRun } from "@/modules/press-runs/queries";

import { getJobCardRecord, releasableItem } from "./queries";
import {
  parseExecutionForm,
  parseJobCardStatusForm,
  parsePlanForm,
  parseReleaseForm,
  runSelectionsFrom,
} from "./validation";

/**
 * Job card writes.
 *
 * A CARD IS RELEASED BY A PERSON, NOT BY A STAGE EVENT (decision J1). The
 * alternative considered and rejected was hanging creation off the stage
 * update — minting a card the first time an item reached a production stage.
 * Four things killed it: the card carries paper, plate and machine details
 * that a human has to supply, so an automatic one is born blank and prints
 * blank; Stage Update has bulk select, so one wrong click would mint eight
 * numbered documents; backward moves are deliberately legal (F4) and the hook
 * could not tell rework from a legitimate split run; and the rule would have
 * to name a stage CODE in a write path, which the Admin screen can rename
 * (C3, F18).
 *
 * ADMIN, PLANNER and ORDER_DESK write. `job_card` is its own resource rather
 * than part of `job_planning` (J2) so that granting Punit the card does not
 * hand him the Phase 4 planning board.
 */

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  /** Set when the action makes the current page unreachable, or moves on (G11). */
  redirectTo?: string;
  /**
   * The item already has a live card. Not an error — a repeat or split run is
   * legitimate (J3) — so the form re-asks with a "Release anyway" button.
   */
  needsSecondCardConfirmation?: boolean;
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

async function requireJobCardWriter(): Promise<Actor> {
  const user = await requireAccess("job_card", "write");
  return { id: user.id, role: user.role };
}

/* -------------------------------------------------------------------------- */
/* Release                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Releases a PO item to production by creating its job card.
 *
 * The number's financial year comes from the CARD's own date — its planned
 * date when it has one, otherwise today in IST (F10). A card planned for 29
 * March belongs to that year's series whether it is released that week or
 * back-entered in May.
 *
 * Allocation happens inside the same transaction as the insert, so a failed
 * save does not burn a `JC-` number (C7, F9).
 *
 * REFUSES on a cancelled item and on one with nothing left to make. Both are
 * hard refusals rather than warnings because neither produces a card anybody
 * could work from: there is no quantity to print on it.
 *
 * WARNS, and does not block, when the item already has a card. Spec section 3
 * is explicit that a PO item may have several — repeat runs and split runs —
 * so refusing the second would break the case the schema was built for (J3).
 */
export async function releaseJobCardAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();

    const parsed = parseReleaseForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const item = await releasableItem(v.poItemId);
    if (!item) return fail("That item is no longer in the system.");

    if (item.pendingQty <= 0) {
      return fail(
        `${item.itemCode} has nothing left to make — the full ordered quantity has been dispatched.`,
      );
    }

    if (v.confirmSecondCard !== "1" && item.cardCount > 0) {
      return {
        ok: false,
        error: null,
        needsSecondCardConfirmation: true,
        message:
          item.cardCount === 1
            ? `${item.itemCode} already has a job card. A second one is for a split or repeat run — release it anyway?`
            : `${item.itemCode} already has ${item.cardCount} job cards. Release another?`,
      };
    }

    const cardDate = v.plannedDate ?? todayIST();

    const row = await db.transaction(async (tx) => {
      const card = await auditedInsert(
        actor,
        jobCard,
        {
          jcNo: await allocateNumber(tx, "JC", cardDate),
          poItemId: v.poItemId,
          // Defaults to what is still owed, read through the view so there is
          // one definition of pending (non-negotiable 2).
          plannedQty: v.plannedQty ?? item.pendingQty,
          plannedDate: v.plannedDate ?? null,
          paperSupplyBy: v.paperSupplyBy ?? null,
          plateSupplyBy: v.plateSupplyBy ?? null,
          plateJobId: v.plateJobId ?? null,
          machineId: v.machineId ?? null,

          // The pen-written half of the paper card (J11). A tick posts "on"
          // and an unticked box posts nothing at all, so absent means false.
          checklistPaper: v.checklistPaper === "on",
          checklistPlates: v.checklistPlates === "on",
          checklistColour: v.checklistColour === "on",

          paperSize: v.paperSize ?? null,
          paperGsm: v.paperGsm ?? null,
          paperFinish: v.paperFinish ?? null,
          sheetsPerReam: v.sheetsPerReam ?? null,
          paperRemarks: v.paperRemarks ?? null,

          execNoOfColours: v.execNoOfColours ?? null,
          execSize: v.execSize ?? null,
          execPlanning: v.execPlanning ?? null,

          fabricationRemarks: v.fabricationRemarks ?? null,
          notes: v.notes ?? null,
        },
        tx,
      );

      /*
       * Run-scope fabrication answers — new die or old — recorded against the
       * card rather than the design (J8).
       *
       * INSIDE THE SAME TRANSACTION as the card itself, so the two arrive
       * together or not at all. A second transaction would leave a numbered
       * card with no answers if the second one failed, and the number would
       * already be burnt.
       */
      await syncJobCardFabrication(actor, tx, card.id, runSelectionsFrom(v));

      /*
       * Ganging, in the SAME transaction as the card (J15).
       *
       * A card that was meant to join a plate and did not is worse than no
       * card: it prints its own sheet, and the press gets two documents for
       * one run. Either both happen or neither does.
       */
      if (v.gangPressRunId) {
        const run = await getRun(v.gangPressRunId, tx);
        if (!run) throw new Error("That press run no longer exists.");
        await auditedUpdate(actor, jobCard, card.id, { pressRunId: run.id }, tx);
      } else if (v.gangNewRun === "1") {
        // The run takes its number from the card's own date, like every other
        // document in the system (F10).
        const run = await auditedInsert(
          actor,
          pressRun,
          {
            runNo: await allocateNumber(tx, "PR", cardDate),
            runDate: v.plannedDate ?? cardDate,
          },
          tx,
        );
        await auditedUpdate(actor, jobCard, card.id, { pressRunId: run.id }, tx);
      }

      return card;
    });

    revalidatePath("/items");
    revalidatePath(`/items/${v.poItemId}`);
    revalidatePath("/stage-update");
    revalidatePath("/job-cards");

    return ok(`${row.jcNo} released.`, `/job-cards/${row.id}`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not release that job card.");
  }
}

/* -------------------------------------------------------------------------- */
/* Edit the plan                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Corrects the card before it goes to the floor.
 *
 * Everything the release form asks, except the item — a card covers exactly one
 * PO item (H1), and repointing it would silently rewrite what was printed.
 *
 * The JC NUMBER IS NEVER REISSUED, on the same reasoning that keeps a tool's
 * number when its type is corrected (C7, I-series): the number is written on a
 * sheet that may already be in somebody's hand, and renumbering after the fact
 * is how the paper and the screen stop agreeing.
 *
 * Deliberately does NOT touch final quantity, wastage or the execution remark.
 * Those are the transcription's, and a plan correction typed a week later must
 * not post a stale copy of them back over what the floor recorded (J6).
 */
export async function updateJobCardPlanAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();

    const parsed = parsePlanForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const existing = await getJobCardRecord(v.id);
    if (!existing) return fail("That job card is no longer in the system.");

    await db.transaction(async (tx) => {
      await auditedUpdate(
        actor,
        jobCard,
        v.id,
        {
          plannedQty: v.plannedQty ?? null,
          plannedDate: v.plannedDate ?? null,
          paperSupplyBy: v.paperSupplyBy ?? null,
          plateSupplyBy: v.plateSupplyBy ?? null,
          plateJobId: v.plateJobId ?? null,
          machineId: v.machineId ?? null,

          checklistPaper: v.checklistPaper === "on",
          checklistPlates: v.checklistPlates === "on",
          checklistColour: v.checklistColour === "on",

          paperSize: v.paperSize ?? null,
          paperGsm: v.paperGsm ?? null,
          paperFinish: v.paperFinish ?? null,
          sheetsPerReam: v.sheetsPerReam ?? null,
          paperRemarks: v.paperRemarks ?? null,

          execNoOfColours: v.execNoOfColours ?? null,
          execSize: v.execSize ?? null,
          execPlanning: v.execPlanning ?? null,

          fabricationRemarks: v.fabricationRemarks ?? null,
          notes: v.notes ?? null,
        },
        tx,
      );

      await syncJobCardFabrication(actor, tx, v.id, runSelectionsFrom(v));
    });

    revalidatePath(`/job-cards/${v.id}`);
    revalidatePath(`/items/${existing.poItemId}`);

    return ok("Saved.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not save those changes.");
  }
}

/* -------------------------------------------------------------------------- */
/* Execution — transcribed back off the paper                                  */
/* -------------------------------------------------------------------------- */

/**
 * Records what actually came off the press.
 *
 * THIS IS A TRANSCRIPTION, and it writes exactly three columns. The printed
 * card leaves final quantity, wastage and remarks blank on purpose (J4) —
 * those numbers do not exist when the sheet goes to the floor — so somebody
 * copies them back in afterwards and the record stops being only on paper.
 *
 * Deliberately separate from any edit of the plan. A person typing a wastage
 * figure a week later should not be posting the machine and the planned
 * quantity back with it, because the version in their browser may be older
 * than the one in the database.
 */
export async function updateJobCardExecutionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();

    const parsed = parseExecutionForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const existing = await getJobCardRecord(v.id);
    if (!existing) return fail("That job card is no longer in the system.");

    await auditedUpdate(actor, jobCard, v.id, {
      finalQty: v.finalQty ?? null,
      wastageQty: v.wastageQty ?? null,
      executionRemarks: v.executionRemarks ?? null,
    });

    revalidatePath(`/job-cards/${v.id}`);
    revalidatePath(`/items/${existing.poItemId}`);

    return ok("Run figures saved.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not save those figures.");
  }
}

/* -------------------------------------------------------------------------- */
/* Unreleasing — cancel, hold, remove                                          */
/* -------------------------------------------------------------------------- */

/**
 * Moves a card's status: Planned, In Process, On Hold, Completed, Cancelled.
 *
 * THIS EXISTED IN THE ENUM AND NOWHERE ELSE (J12). `job_card_status` has
 * carried all five values since the schema was written, and until now nothing
 * in the application could set any of them — every card ever released said
 * `Planned` for the rest of its life, and a card raised by mistake was
 * permanent. The second-card warning (J3) was built to make an accidental
 * release recoverable and there was nothing to recover it with.
 *
 * CANCEL IS THE ORDINARY ANSWER, not removal. A cancelled card was genuinely
 * raised: it has a number, it may have been printed and carried to a press,
 * and the plan changing afterwards is a normal event rather than a typing
 * mistake. It keeps its number and its place in the history, and drops out of
 * the open list and the second-card count.
 *
 * Moving OFF On Hold clears the reason. A card that reads as running while
 * still displaying why it was stopped is worse than one with no reason at all
 * — the same rule F16 applies when a design moves off Approved.
 */
export async function setJobCardStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();

    const parsed = parseJobCardStatusForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const existing = await getJobCardRecord(v.id);
    if (!existing) return fail("That job card is no longer in the system.");

    if (existing.status === v.status && v.status !== "On Hold") {
      return ok("Nothing to change.");
    }

    await auditedUpdate(actor, jobCard, v.id, {
      status: v.status,
      holdReason: v.status === "On Hold" ? (v.holdReason ?? null) : null,
    });

    revalidatePath(`/job-cards/${v.id}`);
    revalidatePath("/job-cards");
    revalidatePath(`/items/${existing.poItemId}`);

    return ok(
      v.status === "Cancelled"
        ? `${existing.jcNo} cancelled. It keeps its number and stays in the history.`
        : `${existing.jcNo} moved to ${v.status}.`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not change that status.");
  }
}

/**
 * Removes a job card from the system (soft delete, non-negotiable 7).
 *
 * FOR A CARD THAT SHOULD NEVER HAVE BEEN TYPED, and nothing else. A job that
 * was planned and then dropped is `Cancelled`, which is a fact worth keeping;
 * removal says the row itself was a mistake and takes it off every screen.
 * Worded on the screen to steer towards cancelling, the same way the tooling
 * register steers towards Scrapped and Lost (I-series).
 *
 * The NUMBER IS NOT REISSUED. `JC-2026-0007` stays consumed after its card is
 * removed, because it may already be printed and lying on a press, and a
 * second card carrying a number somebody has seen on a different job is worse
 * than a gap in the series (C7).
 *
 * REFUSED IN TWO CASES, both because removal would contradict something that
 * physically happened:
 *
 *   - Run figures have been transcribed against it. Final quantity and wastage
 *     are the record of a press run, and the card being a mistake does not
 *     unhappen the run. Cancel instead. Same shape as removePoItemAction
 *     refusing once anything has been dispatched (F21).
 *   - It is on a press run. Removing it would shrink a plate under whoever is
 *     looking at the run screen. Take it off the run first — that action
 *     already exists and is one click (H6).
 */
export async function removeJobCardAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getJobCardRecord(id);
    if (!existing) return fail("That job card is no longer in the system.");

    if (existing.finalQty !== null || existing.wastageQty !== null) {
      return fail(
        `${existing.jcNo} has run figures recorded against it and cannot be removed — that is the record of a press run. Cancel it instead, which keeps the history.`,
      );
    }

    if (existing.pressRunId !== null) {
      return fail(
        `${existing.jcNo} is on a press run. Take it off the run first, then remove it — otherwise the plate changes size under whoever is looking at it.`,
      );
    }

    await auditedSoftDelete(actor, jobCard, id);

    revalidatePath("/job-cards");
    revalidatePath(`/items/${existing.poItemId}`);
    revalidatePath("/stage-update");

    removedTo("/job-cards", `${existing.jcNo} removed. Its number stays consumed.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not remove that job card.");
  }
}

