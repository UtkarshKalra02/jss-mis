"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/auth/guard";
import { auditedInsert, auditedRestore, auditedSoftDelete, type Actor } from "@/db/audit";
import { pettyCash } from "@/db/schema";
import { actionError } from "@/lib/action-error";

import { entryState } from "./queries";
import { parseAddEntry, parseEntryId } from "./validation";

/**
 * Petty cash writes. Three of them, and there is no fourth.
 *
 * ADD, VOID, UN-VOID. There is deliberately no update action (CC2): an entry
 * typed wrong is voided and typed again, which leaves both the mistake and the
 * correction on the sheet. That is the discipline a cash book is for, and it is
 * also what keeps the OWNER's write honest — "an owner may write petty_cash"
 * cannot mean changing an amount after the fact if nothing in the application
 * can change an amount at all.
 *
 * WHO. `requireAccess("petty_cash", "write")` admits ACCOUNTS and OWNER and
 * nobody else — ADMIN has the resource at "read", so the admin sees the tin and
 * cannot post to it (CC3). The real refusal for an OWNER happens again inside
 * the audit wrapper, which is the choke point B2 is enforced at; this guard is
 * what stops the other five roles before a row is read.
 *
 * WHAT IS NOT STAMPED HERE. `entry_date` comes from the form, because the day
 * the cash moved is not the day it was typed — entries are written up the next
 * morning, exactly as stage updates are. The database refuses a future date
 * (0052's trigger), so the form cannot be used to post into tomorrow.
 */

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
};

const ok = (message?: string): FormState => ({ ok: true, error: null, message });
const fail = (error: string): FormState => ({ ok: false, error });

async function requirePettyCashWriter(): Promise<Actor> {
  const user = await requireAccess("petty_cash", "write");
  return { id: user.id, role: user.role };
}

function revalidate() {
  revalidatePath("/petty-cash");
}

/* -------------------------------------------------------------------------- */
/* Add                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Records one movement of cash.
 *
 * `headId` is passed through as `null` rather than omitted when the direction
 * is In. Omitting it would leave the column at its default — which is also null
 * — so the two are equivalent today, and they stop being equivalent the moment
 * somebody gives the column a default. Saying the null out loud is what makes
 * the CHECK's two branches both reachable from here.
 */
export async function addPettyCashEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePettyCashWriter();

    const parsed = parseAddEntry(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    await auditedInsert(actor, pettyCash, {
      entryDate: v.entryDate,
      direction: v.direction,
      amount: v.amount,
      headId: v.direction === "Out" ? (v.headId ?? null) : null,
      party: v.party ?? null,
      purpose: v.purpose,
    });

    revalidate();
    return ok(
      v.direction === "In"
        ? `₹${v.amount} added to the tin.`
        : `₹${v.amount} recorded as spent.`,
    );
  } catch (error) {
    return fail(actionError(error, "Could not save that entry."));
  }
}

/* -------------------------------------------------------------------------- */
/* Void, and un-void                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Removes an entry — which means voiding it, never deleting it.
 *
 * Non-negotiable 7, and in a cash book it is more than a convention: the row
 * stays, struck through, with who voided it and when, and leaves the balance.
 * A deleted entry would make "the closing balance changed and nobody knows why"
 * a thing that can happen.
 *
 * Voiding an already-voided entry is refused rather than treated as a no-op.
 * `auditedSoftDelete` would happily write a second SOFT_DELETE row and move
 * `deleted_at` to now, which quietly rewrites when the void happened.
 */
export async function voidPettyCashEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePettyCashWriter();

    const parsed = parseEntryId(formData);
    if (!parsed.success) return fail("That entry could not be identified.");

    const state = await entryState(parsed.data.id);
    if (!state.exists) return fail("That entry is no longer there.");
    if (state.voided) return fail("That entry is already voided.");

    await auditedSoftDelete(actor, pettyCash, parsed.data.id);

    revalidate();
    return ok("Entry voided. It stays on the sheet, struck through, and leaves the balance.");
  } catch (error) {
    return fail(actionError(error, "Could not void that entry."));
  }
}

/**
 * Puts a voided entry back.
 *
 * Exists for the same reason the manual job close has a reopen: a mis-void with
 * no way back is a worse trap than the mis-void. Refused on an entry that is
 * not voided, so the action cannot be used to stamp `updated_by` on a live row.
 */
export async function restorePettyCashEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requirePettyCashWriter();

    const parsed = parseEntryId(formData);
    if (!parsed.success) return fail("That entry could not be identified.");

    const state = await entryState(parsed.data.id);
    if (!state.exists) return fail("That entry is no longer there.");
    if (!state.voided) return fail("That entry is not voided.");

    await auditedRestore(actor, pettyCash, parsed.data.id);

    revalidate();
    return ok("Entry put back. It counts towards the balance again.");
  } catch (error) {
    return fail(actionError(error, "Could not put that entry back."));
  }
}
