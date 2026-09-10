"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor } from "@/db/audit";
import { enquiry, purchaseOrder } from "@/db/schema";
import { actionError } from "@/lib/action-error";
import { allocateNumber } from "@/lib/numbering";
import { resolveClientId } from "@/modules/clients/resolve";

import { canAssignEnquiryOwner, resolveEnquiryOwner } from "./permissions";
import { getEnquiryRecord } from "./queries";
import {
  TERMINAL_STATUSES,
  createEnquirySchema,
  parseEnquiryForm,
  statusChangeSchema,
  updateEnquirySchema,
  type EnquiryStatus,
} from "./validation";

/**
 * Enquiry writes.
 *
 * EVERY write goes through the audit wrapper (non-negotiable 3), which is also
 * where B2 is enforced: `assertCanWrite` refuses an OWNER outright, so Amit
 * cannot create or edit an enquiry even if a route guard were ever loosened.
 * The wrapper's only OWNER carve-out is delegation, and it does not reach here.
 */

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  redirectTo?: string;
};

/**
 * A client question the server cannot answer on its own.
 *
 * Thrown rather than returned because the resolution happens inside the
 * enquiry's transaction: returning would leave the caller to unwind, and a
 * throw rolls back the allocated enquiry number with it so nothing is burnt.
 */
class ClientResolutionError extends Error {}

const ok = (message?: string, redirectTo?: string): FormState => ({
  ok: true,
  error: null,
  message,
  redirectTo,
});
const fail = (error: string): FormState => ({ ok: false, error });

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "That did not look right.";
}

function refreshed(id?: string) {
  revalidatePath("/enquiries");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/enquiries/${id}`);
}

/**
 * `closed_at` follows the status and is never typed.
 *
 * Won, Lost and Dropped close an enquiry; moving back to Open or Quoted
 * reopens it and clears the date. Deriving it here rather than offering it as
 * a field is the same argument as `current_stage`: a date somebody can set
 * independently of the status is a date that will disagree with it.
 */
function closedAtFor(status: EnquiryStatus, today: string): string | null {
  return TERMINAL_STATUSES.includes(status) ? today : null;
}

/**
 * The reason and the note belong to Lost and to nothing else.
 *
 * Moving an enquiry off Lost clears both, so a row cannot end up reading "Won,
 * because: price". The database only requires the reason to be PRESENT on
 * Lost; keeping it absent everywhere else is this layer's job.
 */
function lostFieldsFor(
  status: EnquiryStatus,
  lostReason: string | undefined,
  lostNotes: string | undefined,
) {
  return status === "Lost"
    ? { lostReason: lostReason as never, lostNotes: lostNotes ?? null }
    : { lostReason: null, lostNotes: null };
}

export async function createEnquiryAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireAccess("enquiry", "write");
  const actor: Actor = { id: user.id, role: user.role };

  const parsed = createEnquirySchema.safeParse(parseEnquiryForm(form));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  try {
    const row = await db.transaction(async (tx) => {
      /*
       * The number comes from the ENQUIRY'S OWN DATE, not from today (F10). An
       * enquiry backfilled in April for a call taken on 28 March belongs to the
       * previous financial year, and allocating inside this transaction means a
       * failed insert does not burn the number.
       */
      const enquiryNo = await allocateNumber(tx, "ENQ", v.enquiryDate);

      // Inside the transaction, so a created client rolls back with the
      // enquiry it was created for rather than being left behind.
      const resolved = await resolveClientId(tx, actor, {
        clientId: v.clientId,
        clientName: v.clientName,
      });
      if (!resolved.ok) throw new ClientResolutionError(resolved.error);

      return auditedInsert(
        actor,
        enquiry,
        {
          enquiryNo,
          clientId: resolved.clientId,
          enquiryDate: v.enquiryDate,
          sourceId: v.sourceId,
          referredBy: v.referredBy ?? null,
          itemDescription: v.itemDescription,
          qty: v.qty ?? null,
          clientRequiredDate: v.clientRequiredDate ?? null,
          /*
           * DECIDED HERE, not by the form (K15). Only ADMIN and OWNER may say
           * who chases an enquiry; for everybody else the posted value is
           * ignored and the raiser owns what they raised. The form omits the
           * control for those roles, and this is what makes that omission a
           * rule rather than a courtesy.
           */
          ownerUserId: resolveEnquiryOwner(user.role, v.ownerUserId, user.id),
          status: v.status,
          closedAt: closedAtFor(v.status, v.enquiryDate),
          ...lostFieldsFor(v.status, v.lostReason, v.lostNotes),
        },
        tx,
      );
    });

    refreshed(row.id);
    return ok(`${row.enquiryNo} recorded.`, `/enquiries/${row.id}`);
  } catch (error) {
    // Its message is written for the person at the desk and names the
    // candidates, so it is passed through rather than flattened into
    // "something went wrong" by actionError.
    if (error instanceof ClientResolutionError) return fail(error.message);
    return fail(actionError(error, "Could not record that enquiry."));
  }
}

export async function updateEnquiryAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireAccess("enquiry", "write");
  const actor: Actor = { id: user.id, role: user.role };

  const parsed = updateEnquirySchema.safeParse({
    ...parseEnquiryForm(form),
    id: form.get("id"),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  try {
    const existing = await getEnquiryRecord(v.id);
    if (!existing) return fail("That enquiry no longer exists.");

    const resolved = await db.transaction((tx) =>
      resolveClientId(tx, actor, { clientId: v.clientId, clientName: v.clientName }),
    );
    if (!resolved.ok) return fail(resolved.error);

    await auditedUpdate(actor, enquiry, v.id, {
      clientId: resolved.clientId,
      enquiryDate: v.enquiryDate,
      sourceId: v.sourceId,
      referredBy: v.referredBy ?? null,
      itemDescription: v.itemDescription,
      qty: v.qty ?? null,
      clientRequiredDate: v.clientRequiredDate ?? null,
      // Falls back to the owner ALREADY ON THE ROW, not to the editor. An
      // order-desk edit to an enquiry Amit handed to somebody else leaves his
      // decision standing rather than quietly reclaiming it.
      ownerUserId: resolveEnquiryOwner(user.role, v.ownerUserId, existing.ownerUserId),
      status: v.status,
      /*
       * Keeps the ORIGINAL closing date when the enquiry was already closed
       * and stays closed. Re-stamping it on every edit would rewrite when the
       * job was actually lost each time somebody fixed a typo.
       */
      closedAt: TERMINAL_STATUSES.includes(v.status)
        ? (existing.closedAt ?? v.enquiryDate)
        : null,
      ...lostFieldsFor(v.status, v.lostReason, v.lostNotes),
    });

    refreshed(v.id);
    return ok("Enquiry updated.");
  } catch (error) {
    return fail(actionError(error, "Could not update that enquiry."));
  }
}

/**
 * The one-click status change from the detail screen.
 *
 * Deliberately narrower than the full form: this is what somebody presses
 * while on the phone, and a path that could also rewrite the client or the
 * quantity would let a stale tab revert them.
 */
export async function setEnquiryStatusAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireAccess("enquiry", "write");
  const actor: Actor = { id: user.id, role: user.role };

  const parsed = statusChangeSchema.safeParse({
    id: form.get("id"),
    status: form.get("status"),
    lostReason: form.get("lostReason"),
    lostNotes: form.get("lostNotes"),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  try {
    const existing = await getEnquiryRecord(v.id);
    if (!existing) return fail("That enquiry no longer exists.");

    await auditedUpdate(actor, enquiry, v.id, {
      status: v.status,
      closedAt: TERMINAL_STATUSES.includes(v.status)
        ? (existing.closedAt ?? existing.enquiryDate)
        : null,
      ...lostFieldsFor(v.status, v.lostReason, v.lostNotes),
    });

    refreshed(v.id);
    return ok(
      v.status === "Won"
        ? "Marked Won. Link the purchase order when it arrives — it is not required."
        : `Marked ${v.status}.`,
    );
  } catch (error) {
    return fail(actionError(error, "Could not change that status."));
  }
}

/**
 * Says who chases this enquiry, and does nothing else.
 *
 * THE ONLY WRITE PATH AN OWNER HAS INTO THIS MODULE. `enquiry` is `read` for
 * OWNER in the matrix, so `requireAccess("enquiry", "write")` — which every
 * other action here calls — refuses Amit outright. This one asks for read and
 * then checks the narrower capability, and the update it issues touches one
 * field, which is the only shape the audit wrapper will accept from an OWNER
 * (K15).
 *
 * ADMIN reaches it the ordinary way.
 */
export async function assignEnquiryOwnerAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireAccess("enquiry");
  if (!canAssignEnquiryOwner(user.role)) {
    return fail("Only an admin or the owner can say who chases an enquiry.");
  }

  const actor: Actor = { id: user.id, role: user.role };
  const id = String(form.get("id") ?? "");
  const ownerUserId = String(form.get("ownerUserId") ?? "");
  if (!id || !ownerUserId) return fail("Choose who should chase this.");

  try {
    const existing = await getEnquiryRecord(id);
    if (!existing) return fail("That enquiry no longer exists.");
    if (existing.ownerUserId === ownerUserId) return ok("No change — already theirs.");

    // ONE FIELD. Anything else in this object would be refused for an OWNER by
    // the audit wrapper, and that refusal is the point rather than an obstacle.
    await auditedUpdate(actor, enquiry, id, { ownerUserId });

    refreshed(id);
    return ok("Enquiry reassigned.");
  } catch (error) {
    return fail(actionError(error, "Could not reassign that enquiry."));
  }
}

/**
 * Links a won enquiry to the PO it became.
 *
 * A PROMPT, NEVER A GATE. Marking an enquiry Won does not require a PO and
 * never will: a repeat customer's order arrives with no enquiry behind it, and
 * PO capture must stay exactly as Deepak knows it — no new required field, no
 * changed validation, no reordered form. The link is written from THIS side,
 * onto the purchase order's nullable `enquiry_id`.
 */
export async function linkPurchaseOrderAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireAccess("enquiry", "write");
  const actor: Actor = { id: user.id, role: user.role };

  const enquiryId = String(form.get("id") ?? "");
  const purchaseOrderId = String(form.get("purchaseOrderId") ?? "");
  if (!enquiryId || !purchaseOrderId) return fail("Choose the purchase order to link.");

  try {
    const existing = await getEnquiryRecord(enquiryId);
    if (!existing) return fail("That enquiry no longer exists.");

    const [po] = await db
      .select({ id: purchaseOrder.id, enquiryId: purchaseOrder.enquiryId })
      .from(purchaseOrder)
      .where(eq(purchaseOrder.id, purchaseOrderId));

    if (!po) return fail("That purchase order no longer exists.");
    if (po.enquiryId && po.enquiryId !== enquiryId) {
      return fail("That purchase order is already linked to another enquiry.");
    }

    await auditedUpdate(actor, purchaseOrder, purchaseOrderId, { enquiryId });

    refreshed(enquiryId);
    return ok("Purchase order linked.");
  } catch (error) {
    return fail(actionError(error, "Could not link that purchase order."));
  }
}

/** Unlinks without touching the PO's own data. */
export async function unlinkPurchaseOrderAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireAccess("enquiry", "write");
  const actor: Actor = { id: user.id, role: user.role };

  const enquiryId = String(form.get("id") ?? "");
  const purchaseOrderId = String(form.get("purchaseOrderId") ?? "");
  if (!enquiryId || !purchaseOrderId) return fail("Nothing to unlink.");

  try {
    await auditedUpdate(actor, purchaseOrder, purchaseOrderId, { enquiryId: null });
    refreshed(enquiryId);
    return ok("Purchase order unlinked.");
  } catch (error) {
    return fail(actionError(error, "Could not unlink that purchase order."));
  }
}

/**
 * Soft delete only (non-negotiable 7).
 *
 * For an enquiry entered against the wrong client or duplicated — NOT for one
 * that came to nothing. That is what Dropped is for, and an enquiry deleted
 * because it was lost is a hole in the funnel the register exists to measure.
 */
export async function removeEnquiryAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireAccess("enquiry", "write");
  const actor: Actor = { id: user.id, role: user.role };

  const id = String(form.get("id") ?? "");
  if (!id) return fail("Nothing to remove.");

  try {
    await auditedSoftDelete(actor, enquiry, id);
    refreshed(id);
    return ok("Enquiry removed.", "/enquiries");
  } catch (error) {
    return fail(actionError(error, "Could not remove that enquiry."));
  }
}
