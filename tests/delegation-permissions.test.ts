import { describe, expect, it } from "vitest";

import {
  assigneeStatuses,
  canDelegateTo,
  canReassign,
  canSetStatus,
  canWriteFields,
  delegatorStatuses,
  isDelegator,
  normaliseStatusPatch,
  type TaskSubject,
  type Viewer,
} from "@/modules/delegation/permissions";

/**
 * Who may change what on a delegated task — tested as a pure function.
 *
 * No database, no session, no screen. This is the rule the whole module exists
 * to enforce and the one most likely to be argued about a year from now, so it
 * is settled here rather than through a form. Decisions G2, G3 and G4.
 */

const PREETI = "11111111-1111-1111-1111-111111111111";
const UTKARSH = "22222222-2222-2222-2222-222222222222";
const AMIT = "33333333-3333-3333-3333-333333333333";
const DEEPAK = "44444444-4444-4444-4444-444444444444";

const assignee: Viewer = { id: PREETI, role: "PLANNER" };
const delegator: Viewer = { id: UTKARSH, role: "ADMIN" };
const owner: Viewer = { id: AMIT, role: "OWNER" };
const stranger: Viewer = { id: DEEPAK, role: "ORDER_DESK" };

const task = (over: Partial<TaskSubject> = {}): TaskSubject => ({
  assignedTo: PREETI,
  assignedBy: UTKARSH,
  status: "In Progress",
  ...over,
});

describe("who may change what", () => {
  it("lets the assignee report progress", () => {
    const verdict = canWriteFields(assignee, task(), ["status", "completedAt", "blockerNote"]);
    expect(verdict.ok).toBe(true);
  });

  it("REFUSES the assignee the task text and the date", () => {
    // The single rule that makes the score mean anything. Somebody who can
    // move their own deadline has not been held to one.
    const date = canWriteFields(assignee, task(), ["expectedDate"]);
    expect(date.ok).toBe(false);
    expect(date.ok === false && date.reason).toContain("Only the person who delegated");

    expect(canWriteFields(assignee, task(), ["task"]).ok).toBe(false);
    expect(canWriteFields(assignee, task(), ["level"]).ok).toBe(false);
  });

  it("refuses a mixed patch outright rather than dropping the bad field", () => {
    // Silently ignoring expectedDate would report success on a change that did
    // not happen, which is worse than refusing.
    expect(canWriteFields(assignee, task(), ["status", "expectedDate"]).ok).toBe(false);
  });

  it("lets the delegator change the goalposts", () => {
    expect(canWriteFields(delegator, task(), ["task", "expectedDate", "level"]).ok).toBe(true);
  });

  it("lets the delegator also report progress on somebody else's behalf", () => {
    expect(canWriteFields(delegator, task(), ["status", "completedAt"]).ok).toBe(true);
  });

  it("refuses somebody with no connection to the task", () => {
    const verdict = canWriteFields(stranger, task(), ["status"]);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("not yours");
  });

  it("treats ADMIN as the delegator on anybody's task", () => {
    // Somebody has to be able to fix a task delegated by a person who has left.
    const admin: Viewer = { id: DEEPAK, role: "ADMIN" };
    expect(isDelegator(admin, task())).toBe(true);
    expect(canWriteFields(admin, task(), ["expectedDate"]).ok).toBe(true);
  });
});

describe("cancelling is not an assignee action (G3)", () => {
  it("keeps Cancelled off the assignee's list", () => {
    expect(assigneeStatuses()).not.toContain("Cancelled");
    expect(delegatorStatuses()).toContain("Cancelled");
  });

  it("refuses the assignee setting Cancelled, with a reason they can act on", () => {
    // The scorecard excludes cancelled tasks from the denominator, so if the
    // person being measured could cancel, cancelling whatever they were about
    // to miss would be the shortest route to 100%.
    const verdict = canSetStatus(assignee, task(), "Cancelled");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("Mark it Blocked");
  });

  it("allows the delegator to cancel", () => {
    expect(canSetStatus(delegator, task(), "Cancelled").ok).toBe(true);
  });

  it("still lets the assignee use every other status", () => {
    for (const status of assigneeStatuses()) {
      expect(canSetStatus(assignee, task(), status).ok, status).toBe(true);
    }
  });
});

describe("reassignment (G4)", () => {
  it("refuses the assignee, so nobody can shed a task they are about to miss", () => {
    const verdict = canReassign(assignee, task());
    expect(verdict.ok).toBe(false);
  });

  it("allows the delegator to move an open task", () => {
    expect(canReassign(delegator, task({ status: "Not Started" })).ok).toBe(true);
    expect(canReassign(delegator, task({ status: "Blocked" })).ok).toBe(true);
  });

  it("refuses to move a DONE task, even for the delegator", () => {
    // Its credit or blame is already scored. Moving it would rewrite a result
    // that has been read out in a meeting.
    const verdict = canReassign(delegator, task({ status: "Done" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("already done");
  });
});

describe("who may delegate", () => {
  it("lets ADMIN delegate to anyone", () => {
    expect(canDelegateTo(delegator, PREETI)).toBe(true);
    expect(canDelegateTo(delegator, AMIT)).toBe(true);
  });

  it("lets a non-admin delegate only to themselves", () => {
    expect(canDelegateTo(assignee, PREETI)).toBe(true);
    expect(canDelegateTo(assignee, DEEPAK)).toBe(false);
  });

  it("lets OWNER delegate to nobody, including himself", () => {
    // The audit wrapper refuses an OWNER insert outright (G2). Reported here
    // too, so the screen can say so rather than failing on submit.
    expect(canDelegateTo(owner, AMIT)).toBe(false);
    expect(canDelegateTo(owner, PREETI)).toBe(false);
  });
});

describe("normalising a status change", () => {
  it("requires a completion date for Done", () => {
    const verdict = normaliseStatusPatch({
      status: "Done",
      completedAt: null,
      blockerNote: null,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("cannot be scored");
  });

  it("requires a note for Blocked, and does not accept whitespace as one", () => {
    expect(
      normaliseStatusPatch({ status: "Blocked", completedAt: null, blockerNote: null }).ok,
    ).toBe(false);
    expect(
      normaliseStatusPatch({ status: "Blocked", completedAt: null, blockerNote: "   " }).ok,
    ).toBe(false);
    expect(
      normaliseStatusPatch({
        status: "Blocked",
        completedAt: null,
        blockerNote: "Waiting on artwork",
      }).ok,
    ).toBe(true);
  });

  it("CLEARS the completion date when a task moves back off Done", () => {
    // v_delegation_status reads completed_at first, so a date left behind would
    // freeze the task's lateness at its old value and go on scoring a finished
    // result for work that is running again.
    const verdict = normaliseStatusPatch({
      status: "In Progress",
      completedAt: "2026-08-01",
      blockerNote: null,
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.value!.completedAt).toBeNull();
  });

  it("keeps the completion date on Done", () => {
    const verdict = normaliseStatusPatch({
      status: "Done",
      completedAt: "2026-08-01",
      blockerNote: null,
    });
    expect(verdict.value!.completedAt).toBe("2026-08-01");
  });
});
