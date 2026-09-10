"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { resolveClientId } from "@/modules/clients/resolve";
import { db } from "@/db";
import {
  auditedInsert,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
} from "@/db/audit";
import { design, designFabrication } from "@/db/schema";
import { actionError } from "@/lib/action-error";
import { allocateNumber } from "@/lib/numbering";
import { syncDesignFabrication, unknownSelections } from "@/modules/fabrication/write";

import { getDesign } from "./queries";
import {
  designSchema,
  fabricationSelectionsFrom,
  quickDesignSchema,
} from "./validation";

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  /** Where the screen should go next. Set on create, so a successful save
   *  leaves the empty form instead of inviting a second click on a form still
   *  full of the design that was just created. */
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

/**
 * A client question the server cannot answer on its own (K19).
 *
 * Thrown rather than returned because the resolution happens inside the
 * design's transaction: a throw rolls back the allocated design code with it,
 * so a refused save does not burn a number.
 */
class ClientResolutionError extends Error {}

/** Spec 6.5: the Design Master belongs to ORDER_DESK (and ADMIN). */
async function requireDesignWriter(): Promise<Actor> {
  const user = await requireAccess("design", "write");
  return { id: user.id, role: user.role };
}

function parse(formData: FormData) {
  return designSchema.safeParse({
    clientId: formData.get("clientId"),
    clientName: formData.get("clientName"),
    jobName: formData.get("jobName"),
    jobSize: formData.get("jobSize"),
    gsm: formData.get("gsm"),
    paperType: formData.get("paperType"),
    printType: formData.get("printType"),
    noOfColours: formData.get("noOfColours"),
    artworkUrl: formData.get("artworkUrl"),
    fabricationOptionIds: formData.getAll("fabricationOptionId").map(String),
    fabricationValueIds: formData.getAll("fabricationValueId").map(String),
    fabricationOtherTexts: formData.getAll("fabricationOtherText").map(String),
  });
}

const orNull = (v: string | undefined) => v ?? null;

export async function createDesignAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDesignWriter();

    const parsed = parse(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const created = await db.transaction(async (tx) => {
      const mismatched = await unknownSelections(tx, fabricationSelectionsFrom(v));
      if (mismatched.length > 0) {
        // The composite foreign key refuses this too; the message here is a
        // sentence rather than a constraint name.
        throw new Error("A fabrication value was posted against the wrong process.");
      }

      // DSN is not year-scoped: a die or plate design outlives any financial
      // year (C7). Allocated inside this transaction, so a failed save gives
      // the number back rather than leaving a gap.
      const designCode = await allocateNumber(tx, "DSN");

      /*
       * The typed client, resolved against live rows INSIDE this transaction
       * (K19) — so a client created for a design that then fails to insert
       * rolls back with it rather than being left behind.
       */
      const resolved = await resolveClientId(tx, actor, {
        clientId: v.clientId,
        clientName: v.clientName,
      });
      if (!resolved.ok) throw new ClientResolutionError(resolved.error);

      const row = await auditedInsert(
        actor,
        design,
        {
          designCode,
          clientId: resolved.clientId,
          jobName: v.jobName,
          jobSize: orNull(v.jobSize),
          gsm: orNull(v.gsm),
          paperType: orNull(v.paperType),
          printType: orNull(v.printType),
          noOfColours: orNull(v.noOfColours),
          artworkUrl: orNull(v.artworkUrl),
          isActive: true,
        },
        tx,
      );


      // What is DONE to the design, as distinct from the stages it passes
      // through (J8). The two are separate vocabularies and neither is derived
      // from the other.
      await syncDesignFabrication(actor, tx, row.id, fabricationSelectionsFrom(v));
      return row;
    });

    revalidatePath("/designs");
    return ok(`${created.designCode} — ${created.jobName} added.`, `/designs/${created.id}`);
  } catch (error) {
    unstable_rethrow(error);
    // Written for the person at the desk and names the candidates, so it
    // is passed through rather than flattened by actionError.
    if (error instanceof ClientResolutionError) return fail(error.message);
    return fail(actionError(error, "Could not add the design."));
  }
}

export async function updateDesignAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDesignWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getDesign(id);
    if (!existing) return fail("That design no longer exists.");

    const parsed = parse(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    await db.transaction(async (tx) => {
      const mismatched = await unknownSelections(tx, fabricationSelectionsFrom(v));
      if (mismatched.length > 0) {
        // The composite foreign key refuses this too; the message here is a
        // sentence rather than a constraint name.
        throw new Error("A fabrication value was posted against the wrong process.");
      }

      const resolved = await resolveClientId(tx, actor, {
        clientId: v.clientId,
        clientName: v.clientName,
      });
      if (!resolved.ok) throw new ClientResolutionError(resolved.error);

      await auditedUpdate(
        actor,
        design,
        id,
        {
          clientId: resolved.clientId,
          jobName: v.jobName,
          jobSize: orNull(v.jobSize),
          gsm: orNull(v.gsm),
          paperType: orNull(v.paperType),
          printType: orNull(v.printType),
          noOfColours: orNull(v.noOfColours),
          artworkUrl: orNull(v.artworkUrl),
        },
        tx,
      );

      await syncDesignFabrication(actor, tx, id, fabricationSelectionsFrom(v));
    });

    revalidatePath("/designs");
    revalidatePath(`/designs/${id}`);
    return ok("Saved.");
  } catch (error) {
    unstable_rethrow(error);
    // Written for the person at the desk and names the candidates, so it
    // is passed through rather than flattened by actionError.
    if (error instanceof ClientResolutionError) return fail(error.message);
    return fail(actionError(error, "Could not save the changes."));
  }
}

/**
 * Approve, reject, or send back to pending (spec 6.5).
 *
 * Approving stamps who and when. Moving OFF Approved clears both, rather than
 * leaving a stale approver on a design that is no longer approved — the
 * database's design_approval_complete check only constrains the Approved case,
 * so nothing else would stop that.
 */
export async function setDesignApprovalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDesignWriter();
    const id = String(formData.get("id") ?? "");
    const decision = String(formData.get("approvalStatus") ?? "");

    if (decision !== "Approved" && decision !== "Rejected" && decision !== "Pending") {
      return fail("Choose approve, reject, or send back to pending.");
    }

    const existing = await getDesign(id);
    if (!existing) return fail("That design no longer exists.");

    await auditedUpdate(actor, design, id, {
      approvalStatus: decision,
      approvedAt: decision === "Approved" ? new Date() : null,
      approvedBy: decision === "Approved" ? actor.id : null,
    });

    revalidatePath("/designs");
    revalidatePath(`/designs/${id}`);

    return ok(
      decision === "Approved"
        ? `${existing.designCode} approved.`
        : decision === "Rejected"
          ? `${existing.designCode} marked rejected.`
          : `${existing.designCode} sent back to pending.`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not record the decision."));
  }
}

export async function setDesignActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDesignWriter();
    const id = String(formData.get("id") ?? "");
    const makeActive = String(formData.get("isActive")) === "true";

    const existing = await getDesign(id);
    if (!existing) return fail("That design no longer exists.");

    await auditedUpdate(actor, design, id, { isActive: makeActive });

    revalidatePath("/designs");
    revalidatePath(`/designs/${id}`);
    return ok(
      makeActive
        ? `${existing.designCode} is active again.`
        : `${existing.designCode} retired — it stays on existing items but cannot be chosen for new ones.`,
    );
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not change the status."));
  }
}

export async function deleteDesignAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireDesignWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getDesign(id);
    if (!existing) return fail("That design no longer exists.");

    await db.transaction(async (tx) => {
      const fabrication = await tx
        .select({ id: designFabrication.id })
        .from(designFabrication)
        .where(and(eq(designFabrication.designId, id), isNull(designFabrication.deletedAt)));

      for (const r of fabrication) await auditedSoftDelete(actor, designFabrication, r.id, tx);

      await auditedSoftDelete(actor, design, id, tx);
    });

    revalidatePath("/designs");
    removedTo("/designs", `${existing.designCode} removed.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not remove the design."));
  }
}

/* -------------------------------------------------------------------------- */
/* Inline create, from the PO capture form                                     */
/* -------------------------------------------------------------------------- */

/** Carries the created row back, so the caller can select it immediately. */
export type QuickDesignState = FormState & {
  design?: { id: string; designCode: string; jobName: string; clientId: string };
};

/**
 * Creates a design from inside PO capture (spec 6.3: "search existing or
 * create").
 *
 * Same access check, same numbering, same audit wrapper as the full form —
 * this is a smaller form over the same write path, not a second one. What it
 * skips is everything the person entering a purchase order does not have in
 * front of them: die and plate references, the route, artwork, approval.
 *
 * Returns the created row rather than just a message, because the caller's
 * next move is to select it on the item row that prompted the dialog. Making
 * them find it in a dropdown that has just changed underneath them would
 * defeat the point.
 */
export async function createQuickDesignAction(
  _prev: QuickDesignState,
  formData: FormData,
): Promise<QuickDesignState> {
  try {
    const actor = await requireDesignWriter();

    const parsed = quickDesignSchema.safeParse({
      clientId: formData.get("clientId"),
      jobName: formData.get("jobName"),
      jobSize: formData.get("jobSize"),
      paperType: formData.get("paperType"),
      gsm: formData.get("gsm"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const created = await db.transaction(async (tx) => {
      const designCode = await allocateNumber(tx, "DSN");

      return auditedInsert(
        actor,
        design,
        {
          designCode,
          clientId: v.clientId,
          jobName: v.jobName,
          jobSize: orNull(v.jobSize),
          paperType: orNull(v.paperType),
          gsm: orNull(v.gsm),
          isActive: true,
        },
        tx,
      );
    });

    revalidatePath("/designs");

    return {
      ok: true,
      error: null,
      message: `${created.designCode} created.`,
      design: {
        id: created.id,
        designCode: created.designCode,
        jobName: created.jobName,
        clientId: created.clientId,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not create the design."));
  }
}

