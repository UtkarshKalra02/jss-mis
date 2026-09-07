"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import {
  auditedInsert,
  auditedRestore,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
} from "@/db/audit";
import { jobCard, jobCardItem, pressRun } from "@/db/schema";
import { actionError } from "@/lib/action-error";
import { allocateNumber, todayIST } from "@/lib/numbering";

import { syncJobCardFabrication } from "@/modules/fabrication/write";
import { getPressRun as getRun } from "@/modules/press-runs/queries";

import {
  getJobCardRecord,
  jobCardItemIds,
  releasableItem,
  releasableItemsByIds,
} from "./queries";
import {
  parseExecutionForm,
  parseJobCardStatusForm,
  parseAddCardItemForm,
  parseBulkReleaseForm,
  parsePlanForm,
  parseReleaseForm,
  parseRemoveCardItemForm,
  cardSelectionsFrom,
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

    /*
     * Is this card joining a plate as it is raised?
     *
     * IT DECIDES WHERE THE SHEET GOES. J15's resolution rule only goes one way
     * — when a card is on a run, the run wins — so a ganged card's own paper
     * and plate columns are never read. Writing the typed sheet onto the card
     * anyway produced a silent loss: somebody filled in size, GSM and quantity,
     * ticked "new run", saved, and the card printed a blank paper block,
     * because the freshly created run had nothing on it and won anyway.
     *
     * So the sheet follows the rule instead of fighting it. Joining a NEW run
     * moves what was typed onto that run, where it is read from. Joining an
     * EXISTING run writes nothing, because that run already has a sheet and a
     * second opinion about it is exactly what J15 exists to prevent — the form
     * stops offering the fields in that case.
     */
    const gangingOnto = Boolean(v.gangPressRunId) || v.gangNewRun === "1";

    /** The sheet, wherever it is about to be written. */
    const sheet = {
      paperSize: v.paperSize ?? null,
      paperGsm: v.paperGsm ?? null,
      paperFinish: v.paperFinish ?? null,
      paperQty: v.paperQty ?? null,
      paperBundle: v.paperBundle ?? null,
      paperParts: v.paperParts ?? null,
      paperRemarks: v.paperRemarks ?? null,
      plateJobId: v.plateJobId ?? null,
      paperSupplyBy: v.paperSupplyBy ?? null,
      plateSupplyBy: v.plateSupplyBy ?? null,
      machineId: v.machineId ?? null,
    };

    /** Nulls for every sheet field, for a card whose run owns them. */
    const noSheet = Object.fromEntries(
      Object.keys(sheet).map((k) => [k, null]),
    ) as typeof sheet;

    const row = await db.transaction(async (tx) => {
      const card = await auditedInsert(
        actor,
        jobCard,
        {
          jcNo: await allocateNumber(tx, "JC", cardDate),
          plannedDate: v.plannedDate ?? null,
          // The sheet lives on the run when there is one (J15).
          ...(gangingOnto ? noSheet : sheet),

          // The pen-written half of the paper card (J11). A tick posts "on"
          // and an unticked box posts nothing at all, so absent means false.
          checklistPaper: v.checklistPaper === "on",
          checklistPlates: v.checklistPlates === "on",
          checklistColour: v.checklistColour === "on",

          execNoOfColours: v.execNoOfColours ?? null,
          execPantone: v.execPantone ?? null,

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
      /*
       * The item this card covers (J25). One row now; the card screen adds
       * more. Written in the SAME transaction as the card, because a numbered
       * card covering nothing is worse than no card — it prints blank and the
       * number is already spent.
       */
      await auditedInsert(
        actor,
        jobCardItem,
        {
          jobCardId: card.id,
          poItemId: v.poItemId,
          // Defaults to what is still owed, read through the view so there is
          // one definition of pending (non-negotiable 2).
          plannedQty: v.plannedQty ?? item.pendingQty,
        },
        tx,
      );

      await syncJobCardFabrication(actor, tx, card.id, cardSelectionsFrom(v));

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

            // What was typed on the form becomes the new plate's sheet. It is
            // the first job on it, so there is nothing to disagree with yet.
            ...sheet,
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
    return fail(actionError(error, "Could not release that job card."));
  }
}

/**
 * Raising several cards on one plate, in one submit (J20).
 *
 * THE SPINE IS UNTOUCHED. This writes N job cards, one per PO item, exactly as
 * the single release does — each keeps its own JC number, its own committed
 * date, its own stage history and its own OTD. What it adds is that they are
 * all created already pointing at one `press_run`, which is what "these go on
 * one plate" has meant since H1. There is no such thing as a job card covering
 * several items, and this does not create one.
 *
 * ONE PLANNED DATE for every card, which is the run's date: one plate is one
 * trip through the press.
 *
 * THE SHEET GOES ON THE RUN, NOT THE CARDS. J15's resolution rule only goes one
 * way — when a card is on a run, the run wins — so writing paper or plate onto
 * these cards as well would create the second answer that rule exists to
 * prevent.
 *
 * ALL OR NOTHING. The run and every card commit together or none do. A
 * half-applied batch would leave a numbered plate holding some of the jobs it
 * was supposed to, and both the PR and the JC numbers already burnt.
 */
export async function releaseGangAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();

    const parsed = parseBulkReleaseForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const items = await releasableItemsByIds(v.poItemIds);
    const byId = new Map(items.map((i) => [i.poItemId, i]));

    // Everything that would stop this being written, gathered before anything
    // is. Reporting the first failure and stopping would send somebody round
    // the loop once per bad row.
    const gone = v.poItemIds.filter((id) => !byId.has(id));
    if (gone.length > 0) {
      return fail(
        `${gone.length} of those items ${gone.length === 1 ? "is" : "are"} no longer in the system. Reload and choose again.`,
      );
    }

    const finished = items.filter((i) => i.pendingQty <= 0);
    if (finished.length > 0) {
      return fail(
        `${finished.map((i) => i.itemCode).join(", ")} ${finished.length === 1 ? "has" : "have"} nothing left to make — the full ordered quantity has been dispatched.`,
      );
    }

    /*
     * J3, asked ONCE for the batch. A second card is legitimate — a split or a
     * repeat run — so this warns and never blocks, and naming the items is the
     * point: the person needs to see which of the five they are doubling up on.
     */
    const repeats = items.filter((i) => i.cardCount > 0);
    if (v.confirmSecondCards !== "1" && repeats.length > 0) {
      return {
        ok: false,
        error: null,
        needsSecondCardConfirmation: true,
        message:
          `${repeats.map((i) => i.itemCode).join(", ")} already ` +
          `${repeats.length === 1 ? "has a job card" : "have job cards"}. ` +
          `A second one is for a split or repeat run — release ${v.poItemIds.length} anyway?`,
      };
    }

    const run = await db.transaction(async (tx) => {
      const created = await auditedInsert(
        actor,
        pressRun,
        {
          runNo: await allocateNumber(tx, "PR", v.runDate),
          runDate: v.runDate,
          machineId: v.machineId ?? null,

          // The sheet, entered once and shared by every job on the plate (J15).
          paperSize: v.paperSize ?? null,
          paperGsm: v.paperGsm ?? null,
          paperFinish: v.paperFinish ?? null,
          paperQty: v.paperQty ?? null,
          paperBundle: v.paperBundle ?? null,
          paperParts: v.paperParts ?? null,
          paperRemarks: v.paperRemarks ?? null,
          plateJobId: v.plateJobId ?? null,
          paperSupplyBy: v.paperSupplyBy ?? null,
          plateSupplyBy: v.plateSupplyBy ?? null,

          notes: v.notes ?? null,
        },
        tx,
      );

      for (const [at, poItemId] of v.poItemIds.entries()) {
        const item = byId.get(poItemId)!;

        const card = await auditedInsert(
          actor,
          jobCard,
          {
            // Allocated inside the loop and inside the transaction, so the
            // series stays gapless if any of this rolls back.
            jcNo: await allocateNumber(tx, "JC", v.runDate),

            // One date for the plate. Not per item, deliberately.
            plannedDate: v.runDate,

            pressRunId: created.id,
          },
          tx,
        );

        await auditedInsert(
          actor,
          jobCardItem,
          {
            jobCardId: card.id,
            poItemId,
            // Blank means all of what is still owed, read through the view so
            // there is one definition of pending (non-negotiable 2).
            plannedQty: v.plannedQtys[at] ?? item.pendingQty,
          },
          tx,
        );
      }

      return created;
    });

    revalidatePath("/job-cards");
    revalidatePath("/press-runs");
    revalidatePath("/stage-update");
    revalidatePath("/items");

    return ok(
      `${run.runNo} raised with ${v.poItemIds.length} jobs on it.`,
      `/press-runs/${run.id}`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not raise those job cards."));
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
          paperQty: v.paperQty ?? null,
          paperBundle: v.paperBundle ?? null,
          paperParts: v.paperParts ?? null,
          paperRemarks: v.paperRemarks ?? null,

          execNoOfColours: v.execNoOfColours ?? null,
          execPantone: v.execPantone ?? null,

          fabricationRemarks: v.fabricationRemarks ?? null,
          notes: v.notes ?? null,
        },
        tx,
      );

      await syncJobCardFabrication(actor, tx, v.id, cardSelectionsFrom(v));
    });

    revalidatePath(`/job-cards/${v.id}`);
    for (const id of await jobCardItemIds(existing.id)) revalidatePath(`/items/${id}`);

    return ok("Saved.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save those changes."));
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
    for (const id of await jobCardItemIds(existing.id)) revalidatePath(`/items/${id}`);

    return ok("Run figures saved.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not save those figures."));
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
    for (const id of await jobCardItemIds(existing.id)) revalidatePath(`/items/${id}`);

    return ok(
      v.status === "Cancelled"
        ? `${existing.jcNo} cancelled. It keeps its number and stays in the history.`
        : `${existing.jcNo} moved to ${v.status}.`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not change that status."));
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
    for (const id of await jobCardItemIds(existing.id)) revalidatePath(`/items/${id}`);
    revalidatePath("/stage-update");

    removedTo("/job-cards", `${existing.jcNo} removed. Its number stays consumed.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not remove that job card."));
  }
}

/* -------------------------------------------------------------------------- */
/* The items a card covers (J25)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Putting another item on a card that already exists.
 *
 * THIS IS THE POINT OF J25. A repeat of the same printing used to cost a whole
 * new card — the same paper, plate, machine, colours and fabrication typed
 * again — and adding the item to the card that already describes the job is
 * what the floor actually does.
 *
 * The card's specification is untouched. Only which items it covers changes,
 * which is why this is a separate action from the plan form: a transcription or
 * a plan edit must never carry an item list with it, the same reason J6 keeps
 * the run figures on their own form.
 *
 * RESTORES A SOFT-DELETED ROW rather than inserting over it. The unique index
 * is partial (C5), so a removed row is invisible to it and a plain insert would
 * succeed — leaving two rows for one item on one card, one of them dead, and a
 * quantity that depends on which one a query happens to read first.
 */
export async function addCardItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();

    const parsed = parseAddCardItemForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const card = await getJobCardRecord(v.jobCardId);
    if (!card) return fail("That job card no longer exists.");

    if (card.status === "Cancelled") {
      return fail(`${card.jcNo} is cancelled. Reinstate it before adding work to it.`);
    }

    const item = await releasableItem(v.poItemId);
    if (!item) return fail("That item is no longer in the system.");

    if (item.pendingQty <= 0) {
      return fail(
        `${item.itemCode} has nothing left to make — the full ordered quantity has been dispatched.`,
      );
    }

    const already = await jobCardItemIds(v.jobCardId);
    if (already.includes(v.poItemId)) {
      return fail(`${item.itemCode} is already on ${card.jcNo}.`);
    }

    await db.transaction(async (tx) => {
      const [dead] = await tx
        .select({ id: jobCardItem.id })
        .from(jobCardItem)
        .where(
          and(eq(jobCardItem.jobCardId, v.jobCardId), eq(jobCardItem.poItemId, v.poItemId)),
        )
        .limit(1);

      if (dead) {
        await auditedRestore(actor, jobCardItem, dead.id, tx);
        await auditedUpdate(
          actor,
          jobCardItem,
          dead.id,
          { plannedQty: v.plannedQty ?? item.pendingQty },
          tx,
        );
        return;
      }

      await auditedInsert(
        actor,
        jobCardItem,
        {
          jobCardId: v.jobCardId,
          poItemId: v.poItemId,
          plannedQty: v.plannedQty ?? item.pendingQty,
        },
        tx,
      );
    });

    revalidatePath(`/job-cards/${v.jobCardId}`);
    revalidatePath(`/items/${v.poItemId}`);
    revalidatePath("/job-cards");
    revalidatePath("/items");

    return ok(`${item.itemCode} added to ${card.jcNo}.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not add that item to the card."));
  }
}

/**
 * Taking an item off a card.
 *
 * SOFT DELETE, never a hard one (non-negotiable 7). The row stays, so the audit
 * log can still answer what the card covered last Tuesday.
 *
 * A card must keep at least one item. An empty card is a numbered document
 * describing no job — it would print blank, appear on the grid with nothing in
 * its item column, and its number is already spent. Removing the last item is
 * removing the card, and that has its own action which says so.
 */
export async function removeCardItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireJobCardWriter();

    const parsed = parseRemoveCardItemForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const card = await getJobCardRecord(v.jobCardId);
    if (!card) return fail("That job card no longer exists.");

    const covered = await jobCardItemIds(v.jobCardId);
    if (!covered.includes(v.poItemId)) return fail("That item is not on this card.");

    if (covered.length <= 1) {
      return fail(
        `${card.jcNo} would be left covering no job at all. Remove the card itself instead.`,
      );
    }

    const [row] = await db
      .select({ id: jobCardItem.id })
      .from(jobCardItem)
      .where(
        and(
          eq(jobCardItem.jobCardId, v.jobCardId),
          eq(jobCardItem.poItemId, v.poItemId),
          isNull(jobCardItem.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return fail("That item is not on this card.");

    await auditedSoftDelete(actor, jobCardItem, row.id);

    revalidatePath(`/job-cards/${v.jobCardId}`);
    revalidatePath(`/items/${v.poItemId}`);
    revalidatePath("/job-cards");
    revalidatePath("/items");

    return ok("Removed from this card.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not remove that item from the card."));
  }
}

