"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import {
  auditedInsert,
  auditedRestore,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
  type Tx,
} from "@/db/audit";
import { design, designProcess, stage } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";

import { getDesign } from "./queries";
import { designSchema, quickDesignSchema } from "./validation";

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

/** Spec 6.5: the Design Master belongs to ORDER_DESK (and ADMIN). */
async function requireDesignWriter(): Promise<Actor> {
  const user = await requireAccess("design", "write");
  return { id: user.id, role: user.role };
}

function parse(formData: FormData) {
  return designSchema.safeParse({
    clientId: formData.get("clientId"),
    jobName: formData.get("jobName"),
    jobSize: formData.get("jobSize"),
    gsm: formData.get("gsm"),
    paperType: formData.get("paperType"),
    printType: formData.get("printType"),
    noOfColours: formData.get("noOfColours"),
    artworkUrl: formData.get("artworkUrl"),
    processes: formData.getAll("processes").map(String),
  });
}

const orNull = (v: string | undefined) => v ?? null;

/**
 * Rejects a route referencing a stage that does not exist.
 *
 * The foreign key on design_process.stage_code would catch this anyway, but it
 * would arrive as a constraint-violation string. Checking first turns that into
 * a sentence naming the offending code.
 */
async function unknownStages(codes: string[], tx: Tx): Promise<string[]> {
  if (codes.length === 0) return [];

  const found = await tx
    .select({ code: stage.code })
    .from(stage)
    .where(inArray(stage.code, codes));

  const known = new Set(found.map((r) => r.code));
  return codes.filter((c) => !known.has(c));
}

/**
 * Brings a design's route to exactly `wanted`.
 *
 * Additions RESTORE a soft-deleted row when one exists rather than inserting a
 * new one. `design_process` has a full unique constraint on
 * (design_id, stage_code), so the soft-deleted row is still visible to it and a
 * plain insert would fail — and taking lamination off a design and putting it
 * back a month later is completely ordinary.
 */
async function syncProcesses(
  actor: Actor,
  tx: Tx,
  designId: string,
  wanted: string[],
): Promise<void> {
  const existing = await tx
    .select({
      id: designProcess.id,
      stageCode: designProcess.stageCode,
      deletedAt: designProcess.deletedAt,
    })
    .from(designProcess)
    .where(eq(designProcess.designId, designId));

  const live = new Map(existing.filter((r) => !r.deletedAt).map((r) => [r.stageCode, r.id]));
  const dead = new Map(existing.filter((r) => r.deletedAt).map((r) => [r.stageCode, r.id]));
  const target = new Set(wanted);

  for (const code of target) {
    if (live.has(code)) continue;

    const revivable = dead.get(code);
    if (revivable) {
      await auditedRestore(actor, designProcess, revivable, tx);
    } else {
      await auditedInsert(actor, designProcess, { designId, stageCode: code }, tx);
    }
  }

  for (const [code, id] of live) {
    if (!target.has(code)) await auditedSoftDelete(actor, designProcess, id, tx);
  }
}

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
      const missing = await unknownStages(v.processes, tx);
      if (missing.length > 0) {
        throw new Error(`Unknown stage${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
      }

      // DSN is not year-scoped: a die or plate design outlives any financial
      // year (C7). Allocated inside this transaction, so a failed save gives
      // the number back rather than leaving a gap.
      const designCode = await allocateNumber(tx, "DSN");

      const row = await auditedInsert(
        actor,
        design,
        {
          designCode,
          clientId: v.clientId,
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

      await syncProcesses(actor, tx, row.id, v.processes);
      return row;
    });

    revalidatePath("/designs");
    return ok(`${created.designCode} — ${created.jobName} added.`, `/designs/${created.id}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not add the design.");
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
      const missing = await unknownStages(v.processes, tx);
      if (missing.length > 0) {
        throw new Error(`Unknown stage${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
      }

      await auditedUpdate(
        actor,
        design,
        id,
        {
          clientId: v.clientId,
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

      await syncProcesses(actor, tx, id, v.processes);
    });

    revalidatePath("/designs");
    revalidatePath(`/designs/${id}`);
    return ok("Saved.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the changes.");
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
    return fail(error instanceof Error ? error.message : "Could not record the decision.");
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
    return fail(error instanceof Error ? error.message : "Could not change the status.");
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
      // The route rows go with it. Without this they stay live, and the design
      // still counts toward "which designs need foiling?" after it is gone.
      const routes = await tx
        .select({ id: designProcess.id })
        .from(designProcess)
        .where(and(eq(designProcess.designId, id), isNull(designProcess.deletedAt)));

      for (const r of routes) await auditedSoftDelete(actor, designProcess, r.id, tx);

      await auditedSoftDelete(actor, design, id, tx);
    });

    revalidatePath("/designs");
    return ok(`${existing.designCode} removed.`, "/designs");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not remove the design.");
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
    return fail(error instanceof Error ? error.message : "Could not create the design.");
  }
}

