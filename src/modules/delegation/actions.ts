"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/auth/guard";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor } from "@/db/audit";
import { delegationTask } from "@/db/schema";
import { todayIST } from "@/lib/dates";

import {
  canDelegateTo,
  canReassign,
  canSetStatus,
  canWriteFields,
  normaliseStatusPatch,
  type DelegationStatus,
  type TaskSubject,
  type Viewer,
} from "./permissions";
import { getTaskRecord } from "./queries";
import {
  createTaskSchema,
  definitionPatchSchema,
  reassignSchema,
  statusPatchSchema,
} from "./validation";

/**
 * Delegation writes.
 *
 * EVERY permission decision here goes through permissions.ts, which is a pure
 * function tested without a database. These actions read the row, ask that
 * function, and either write or refuse. They contain no rules of their own —
 * a rule invented in an action is a rule that exists in one place and is
 * checked in one code path.
 *
 * The separation these actions enforce is the reason the scorecard means
 * anything: the person doing the work reports progress, and the person who
 * delegated it owns what the task is and when it is due. Enforced SERVER-SIDE,
 * not by which inputs a form happens to render — a form is a suggestion.
 */

export type FormState = { ok: boolean; error: string | null; message?: string };

const ok = (message?: string): FormState => ({ ok: true, error: null, message });
const fail = (error: string): FormState => ({ ok: false, error });

async function requireDelegationUser(): Promise<Actor & { viewer: Viewer }> {
  const user = await requireAccess("delegation", "write");
  const actor = { id: user.id, role: user.role };
  return { ...actor, viewer: actor };
}

function subjectOf(row: {
  assignedTo: string;
  assignedBy: string;
  status: string;
}): TaskSubject {
  return {
    assignedTo: row.assignedTo,
    assignedBy: row.assignedBy,
    status: row.status as DelegationStatus,
  };
}

function revalidate(id?: string) {
  revalidatePath("/delegation");
  revalidatePath("/delegation/scorecard");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/delegation/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Delegate — create                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates a task.
 *
 * `date_given` is left to the DATABASE default (today_ist()), not stamped from
 * the server clock. C10: the factory's day boundary is Asia/Kolkata, and a task
 * delegated at 8am IST is 02:30 UTC the same day while one at 2am IST is the
 * previous day in UTC — so a naive server date would put a task in the wrong
 * day roughly a quarter of the time.
 */
export async function createTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { viewer, ...actor } = await requireDelegationUser();

    const parsed = createTaskSchema.safeParse({
      assignedTo: formData.get("assignedTo"),
      task: formData.get("task"),
      expectedDate: formData.get("expectedDate"),
      level: formData.get("level"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    if (!canDelegateTo(viewer, v.assignedTo)) {
      return fail(
        viewer.role === "OWNER"
          ? "Owners cannot create delegated tasks. Ask an admin to delegate it to you."
          : "You can only delegate tasks to yourself. An admin can delegate to anyone.",
      );
    }

    // Checked here as well as by the database CHECK, so the message is a
    // sentence rather than a constraint name.
    if (v.expectedDate < todayIST()) {
      return fail("The expected date is in the past. A task cannot be due before it is given.");
    }

    await auditedInsert(actor, delegationTask, {
      assignedTo: v.assignedTo,
      assignedBy: actor.id,
      task: v.task,
      expectedDate: v.expectedDate,
      level: v.level,
    });

    revalidate();
    return ok("Task delegated.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not create that task.");
  }
}

/* -------------------------------------------------------------------------- */
/* My Tasks — the assignee reports progress                                    */
/* -------------------------------------------------------------------------- */

/**
 * Updates status, completion date and blocker note — and NOTHING else.
 *
 * The field list is closed at the top of this function rather than derived from
 * whatever the form posted. A form that grows an `expectedDate` input by
 * accident cannot widen what this action writes, because this action never
 * reads one.
 */
export async function updateStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { viewer, ...actor } = await requireDelegationUser();

    const parsed = statusPatchSchema.safeParse({
      id: formData.get("id"),
      status: formData.get("status"),
      completedAt: formData.get("completedAt"),
      blockerNote: formData.get("blockerNote"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const row = await getTaskRecord(v.id);
    if (!row) return fail("That task no longer exists.");
    const task = subjectOf(row);

    const allowed = canWriteFields(viewer, task, ["status", "completedAt", "blockerNote"]);
    if (!allowed.ok) return fail(allowed.reason);

    // Separate from the field check on purpose: the assignee MAY write the
    // status column and yet may not write every VALUE of it. Cancelled is the
    // one that matters (G3), and a column-only check would let it through.
    const statusAllowed = canSetStatus(viewer, task, v.status);
    if (!statusAllowed.ok) return fail(statusAllowed.reason);

    const normalised = normaliseStatusPatch({
      status: v.status,
      completedAt: v.completedAt && v.completedAt.length > 0 ? v.completedAt : null,
      blockerNote: v.blockerNote && v.blockerNote.length > 0 ? v.blockerNote : null,
    });
    if (!normalised.ok) return fail(normalised.reason);

    await auditedUpdate(actor, delegationTask, v.id, normalised.value!);

    revalidate(v.id);
    return ok("Saved.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save that change.");
  }
}

/* -------------------------------------------------------------------------- */
/* The delegator owns what the task is                                         */
/* -------------------------------------------------------------------------- */

/**
 * Changes the task text, the expected date, or the level.
 *
 * Refused for the assignee, which is the single rule that makes the score
 * meaningful. Somebody who can move their own deadline has not been held to
 * one, and a scorecard built on that is a report about paperwork.
 */
export async function updateDefinitionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { viewer, ...actor } = await requireDelegationUser();

    const parsed = definitionPatchSchema.safeParse({
      id: formData.get("id"),
      task: formData.get("task"),
      expectedDate: formData.get("expectedDate"),
      level: formData.get("level"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const row = await getTaskRecord(v.id);
    if (!row) return fail("That task no longer exists.");

    const allowed = canWriteFields(viewer, subjectOf(row), ["task", "expectedDate", "level"]);
    if (!allowed.ok) return fail(allowed.reason);

    if (v.expectedDate < row.dateGiven) {
      return fail("The expected date cannot be before the date the task was given.");
    }

    await auditedUpdate(actor, delegationTask, v.id, {
      task: v.task,
      expectedDate: v.expectedDate,
      level: v.level,
    });

    revalidate(v.id);
    return ok("Task updated.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not update that task.");
  }
}

/* -------------------------------------------------------------------------- */
/* Cancel — withdrawal, not progress                                           */
/* -------------------------------------------------------------------------- */

/**
 * Withdraws a task (decision G3).
 *
 * Its own action rather than a status option, because it is the one status the
 * assignee may not set and giving it a separate door makes that visible instead
 * of implicit. Cancelled tasks leave the scorecard denominator, which is only
 * safe because of exactly this restriction.
 */
export async function cancelTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { viewer, ...actor } = await requireDelegationUser();
    const id = String(formData.get("id") ?? "");

    const row = await getTaskRecord(id);
    if (!row) return fail("That task no longer exists.");

    const allowed = canSetStatus(viewer, subjectOf(row), "Cancelled");
    if (!allowed.ok) return fail(allowed.reason);

    if (row.status === "Done") {
      return fail("That task is already done. Cancelling it now would erase a finished result.");
    }

    await auditedUpdate(actor, delegationTask, id, {
      status: "Cancelled",
      completedAt: null,
    });

    revalidate(id);
    return ok("Task withdrawn. It no longer counts on the scorecard.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not cancel that task.");
  }
}

/* -------------------------------------------------------------------------- */
/* Reassign                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hands a task to somebody else (decision G4).
 *
 * The audit trail showing BOTH people is not extra work here: auditedUpdate
 * writes whole-row before/after snapshots, so the row it produces already names
 * who it was taken from and who it went to. `reassignmentsFor()` reads exactly
 * those rows back for the task screen, so the history is legible rather than
 * merely present.
 *
 * The assignee cannot do this, so nobody can shed a task they are about to
 * miss. A Done task cannot be moved at all — its result is already scored.
 */
export async function reassignTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { viewer, ...actor } = await requireDelegationUser();

    const parsed = reassignSchema.safeParse({
      id: formData.get("id"),
      assignedTo: formData.get("assignedTo"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const row = await getTaskRecord(v.id);
    if (!row) return fail("That task no longer exists.");

    const allowed = canReassign(viewer, subjectOf(row));
    if (!allowed.ok) return fail(allowed.reason);

    if (row.assignedTo === v.assignedTo) return fail("That is already who it is assigned to.");

    await auditedUpdate(actor, delegationTask, v.id, { assignedTo: v.assignedTo });

    revalidate(v.id);
    return ok("Task reassigned. The change is recorded against both people.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not reassign that task.");
  }
}

/* -------------------------------------------------------------------------- */
/* Remove                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Soft-deletes a task entered by mistake (non-negotiable 7).
 *
 * Distinct from cancelling: cancel says the task existed and was withdrawn and
 * leaves it visible on the task's own screen; remove says it should never have
 * been typed. Only the delegator or an ADMIN, and never once it is Done —
 * otherwise removal is a way to make a late result disappear from the score,
 * which is the same hole G3 closes for cancel.
 */
export async function removeTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { viewer, ...actor } = await requireDelegationUser();
    const id = String(formData.get("id") ?? "");

    const row = await getTaskRecord(id);
    if (!row) return fail("That task no longer exists.");

    const allowed = canReassign(viewer, subjectOf(row));
    if (!allowed.ok) {
      return fail(
        row.status === "Done"
          ? "That task is done. Removing it would take a scored result off the scorecard."
          : "Only the person who delegated this task, or an admin, can remove it.",
      );
    }

    await auditedSoftDelete(actor, delegationTask, id);

    revalidate(id);
    return ok("Task removed.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not remove that task.");
  }
}
