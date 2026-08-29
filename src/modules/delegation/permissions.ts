/**
 * WHO MAY CHANGE WHAT on a delegated task — a pure function.
 *
 * Extracted from the actions for the same reason the stage-config diff (E14)
 * and the stage precedence rules (F25) were: this is the rule the whole module
 * exists to enforce, it is the one most likely to be argued about a year from
 * now, and an argument is far easier to settle against a test than against a
 * server action that needs a session and a database to run.
 *
 * The rule, in one sentence: THE PERSON DOING THE WORK CANNOT MOVE THE
 * GOALPOSTS. They report progress; the person who delegated the task owns what
 * the task is and when it is due. A score produced under any weaker rule is a
 * number about paperwork rather than about performance.
 *
 * Three separate things fall out of that, and they are separate on purpose:
 *
 *   - the ASSIGNEE may change status, completed_at and blocker_note;
 *   - the DELEGATOR (and ADMIN) may change the task text, the expected date,
 *     the level, and may cancel or reassign;
 *   - CANCELLING is not an assignee action, even though it is a status. See
 *     assigneeStatuses() below — this is decision G3 and it is the difference
 *     between a scorecard and a formality.
 */

import type { Role } from "@/auth/roles";

export type DelegationStatus =
  | "Not Started"
  | "In Progress"
  | "Done"
  | "Blocked"
  | "Cancelled";

export type DelegationLevel = "L2" | "L3" | "L4";

/** The parts of a task the rules below need. Deliberately not the whole row. */
export type TaskSubject = {
  assignedTo: string;
  assignedBy: string;
  status: DelegationStatus;
};

export type Viewer = { id: string; role: Role };

/* -------------------------------------------------------------------------- */
/* Who is who                                                                  */
/* -------------------------------------------------------------------------- */

export const isAssignee = (viewer: Viewer, task: TaskSubject) =>
  viewer.id === task.assignedTo;

/**
 * ADMIN counts as the delegator everywhere.
 *
 * Not laziness: somebody has to be able to fix a task delegated by a person who
 * has since left, and the alternative is editing rows in psql, which is both
 * unaudited in practice and unavailable to the person who actually needs it.
 */
export const isDelegator = (viewer: Viewer, task: TaskSubject) =>
  viewer.id === task.assignedBy || viewer.role === "ADMIN";

/* -------------------------------------------------------------------------- */
/* Creating                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Who a person may delegate TO.
 *
 * ADMIN delegates to anyone; everybody else may only delegate to themselves,
 * which makes the module usable as a personal commitment log without letting
 * the org chart be rewritten from a form.
 *
 * OWNER may delegate to nobody at all, including himself. The audit wrapper
 * refuses an OWNER insert outright (G2) — the exception granted there is an
 * UPDATE on rows already assigned to him, and it stops well short of letting
 * him author his own accountability. Reported here as well as enforced there,
 * so the screen can say so rather than showing a form that fails on submit.
 */
export function canDelegateTo(viewer: Viewer, targetUserId: string): boolean {
  if (viewer.role === "OWNER") return false;
  if (viewer.role === "ADMIN") return true;
  return viewer.id === targetUserId;
}

export const canDelegateAtAll = (viewer: Viewer) =>
  canDelegateTo(viewer, viewer.id) || viewer.role === "ADMIN";

/* -------------------------------------------------------------------------- */
/* Updating                                                                    */
/* -------------------------------------------------------------------------- */

/** The three fields the person doing the work reports through. */
export const ASSIGNEE_FIELDS = ["status", "completedAt", "blockerNote"] as const;

/** What the person who set the task owns. */
export const DELEGATOR_FIELDS = ["task", "expectedDate", "level"] as const;

export type AssigneeField = (typeof ASSIGNEE_FIELDS)[number];
export type DelegatorField = (typeof DELEGATOR_FIELDS)[number];

/**
 * Statuses the ASSIGNEE may move a task to.
 *
 * Cancelled is missing, and that is the entire point (decision G3). Cancelling
 * is not progress on a task; it is withdrawal of the task. If the person being
 * measured could cancel, then cancelling whatever they were about to miss would
 * be the shortest route to a perfect score — and because the scorecard excludes
 * cancelled tasks from the denominator, it would work silently and completely.
 *
 * The two rules only hold together: excluding cancelled tasks from the score is
 * safe BECAUSE only the delegator can cancel. Change either one and the other
 * becomes wrong.
 */
export function assigneeStatuses(): DelegationStatus[] {
  return ["Not Started", "In Progress", "Done", "Blocked"];
}

/** Everything, for the person who owns the task. */
export function delegatorStatuses(): DelegationStatus[] {
  return ["Not Started", "In Progress", "Done", "Blocked", "Cancelled"];
}

export type PatchVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether `viewer` may write exactly these fields on this task.
 *
 * Takes the field NAMES rather than the values, because the question "may you
 * touch this column" is separate from "is this value valid" and mixing them is
 * how one of them ends up only half-checked.
 */
export function canWriteFields(
  viewer: Viewer,
  task: TaskSubject,
  fields: readonly string[],
): PatchVerdict {
  const assignee = isAssignee(viewer, task);
  const delegator = isDelegator(viewer, task);

  if (!assignee && !delegator) {
    return { ok: false, reason: "This task is not yours to change." };
  }

  for (const field of fields) {
    const isAssigneeField = (ASSIGNEE_FIELDS as readonly string[]).includes(field);
    const isDelegatorField = (DELEGATOR_FIELDS as readonly string[]).includes(field);

    if (isAssigneeField && (assignee || delegator)) continue;
    if (isDelegatorField && delegator) continue;

    if (isDelegatorField && assignee) {
      return {
        ok: false,
        reason:
          "Only the person who delegated this task can change what it is or when it is due. " +
          "Ask them — moving your own deadline is the one thing this screen will not do.",
      };
    }

    return { ok: false, reason: `"${field}" cannot be changed here.` };
  }

  return { ok: true };
}

/**
 * Whether a status change is permitted for this person.
 *
 * Separate from canWriteFields because the assignee MAY write `status` and yet
 * may not write every VALUE of it. A check on the column alone would let
 * "Cancelled" through the one gate that exists to stop it.
 */
export function canSetStatus(
  viewer: Viewer,
  task: TaskSubject,
  next: DelegationStatus,
): PatchVerdict {
  const allowed = isDelegator(viewer, task) ? delegatorStatuses() : assigneeStatuses();

  if (!allowed.includes(next)) {
    return {
      ok: false,
      reason:
        next === "Cancelled"
          ? "Only the person who delegated this task can cancel it. Mark it Blocked and say why instead."
          : `"${next}" is not a status you can set.`,
    };
  }

  return { ok: true };
}

/**
 * Whether this task may be handed to somebody else (decision G4).
 *
 * Two conditions, and the second is the one that matters. Reassignment moves
 * the whole history of a task onto a new person, so:
 *
 *   - the ASSIGNEE may never do it, or anybody could shed a task they were
 *     about to miss;
 *   - a DONE task may never be reassigned by anyone, because its credit or
 *     blame is already settled and moving it would rewrite a scored result.
 *
 * An open task CAN still be moved off somebody by their delegator, and that is
 * a deliberate limit rather than an oversight: genuine handovers happen, and
 * refusing them would get worked around by cancel-and-recreate, which loses the
 * history entirely. The audit row names both people, which is the protection
 * that remains.
 */
export function canReassign(viewer: Viewer, task: TaskSubject): PatchVerdict {
  if (!isDelegator(viewer, task)) {
    return {
      ok: false,
      reason: "Only the person who delegated this task, or an admin, can hand it to somebody else.",
    };
  }

  if (task.status === "Done") {
    return {
      ok: false,
      reason:
        "This task is already done. Reassigning it now would move a finished result onto somebody who did not do it.",
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Shape of a valid status change                                              */
/* -------------------------------------------------------------------------- */

export type StatusPatch = {
  status: DelegationStatus;
  completedAt: string | null;
  blockerNote: string | null;
};

/**
 * Normalises and checks a status change before it reaches the database.
 *
 * The database has CHECK constraints saying the same things (migration 0011),
 * and both are wanted. The constraints are what make the rule true for every
 * writer including a psql session; this is what turns a violation into a
 * sentence somebody can act on instead of a Postgres error string.
 *
 * It also CLEARS completed_at when a task moves off Done, which is not
 * tidiness: v_delegation_status reads completed_at first, so a date left behind
 * would freeze the task's lateness at its old value and quietly keep scoring a
 * finished result for work that is running again.
 */
export function normaliseStatusPatch(patch: StatusPatch): PatchVerdict & {
  value?: StatusPatch;
} {
  const note = patch.blockerNote?.trim() ? patch.blockerNote.trim() : null;

  if (patch.status === "Done") {
    if (!patch.completedAt) {
      return {
        ok: false,
        reason: "Give the date it was actually finished. Done without a date cannot be scored.",
      };
    }
    return { ok: true, value: { status: "Done", completedAt: patch.completedAt, blockerNote: note } };
  }

  if (patch.status === "Blocked") {
    if (!note) {
      return {
        ok: false,
        reason: "Say what is blocking it. “Blocked” on its own reads as a reason and is not one.",
      };
    }
    return { ok: true, value: { status: "Blocked", completedAt: null, blockerNote: note } };
  }

  // Not Started, In Progress, Cancelled — no completion date, note optional.
  return {
    ok: true,
    value: { status: patch.status, completedAt: null, blockerNote: note },
  };
}
