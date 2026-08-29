import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import {
  ReassignForm,
  TaskDefinitionForm,
  WithdrawCard,
} from "@/components/delegation/task-controls";
import { isAssignee, isDelegator } from "@/modules/delegation/permissions";
import {
  assignableUsers,
  getTask,
  reassignmentsFor,
  userNames,
} from "@/modules/delegation/queries";

export const metadata: Metadata = { title: "Task · JSS MIS" };

/**
 * One delegated task.
 *
 * Two audiences on one screen, and what each sees is decided by the same pure
 * function the server actions use. The assignee gets the history and no
 * controls — their controls are the status form on My Tasks. The delegator gets
 * the goalposts: wording, date, level, reassign, withdraw.
 *
 * The reassignment history is read back out of audit_log (G4) rather than kept
 * in a second table. Every move already lands there as a before/after snapshot;
 * showing it here is what turns "the audit trail records it" into something a
 * person can actually see.
 */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("delegation", "write");
  const { id } = await params;

  const task = await getTask(id);
  if (!task) notFound();

  const viewer = { id: user.id, role: user.role };
  const delegator = isDelegator(viewer, task);
  const assignee = isAssignee(viewer, task);

  // A task is nobody else's business. Everyone can reach the module; not
  // everyone can read every task in it.
  if (!delegator && !assignee) notFound();

  const [moves, names, assignees] = await Promise.all([
    reassignmentsFor(id),
    userNames(),
    delegator ? assignableUsers() : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-2xl">
      <Link href="/delegation" className="text-muted-foreground text-[13px] hover:underline">
        ← My tasks
      </Link>

      <h1 className="page-title mt-2">{task.task}</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {task.level} · {task.assignedByName} → {task.assignedToName} · given {task.dateGiven}{" "}
        · due {task.expectedDate} · {task.status}
        {task.status === "Done" && task.completedAt ? ` on ${task.completedAt}` : ""}
      </p>

      {task.isOverdue ? (
        <p className="border-overdue/40 text-overdue mt-4 rounded-md border px-3 py-2 text-[13px]">
          {task.daysLate} day{task.daysLate === 1 ? "" : "s"} overdue.
        </p>
      ) : null}

      {task.status === "Blocked" && task.blockerNote ? (
        <p className="border-at-risk/40 mt-4 rounded-md border px-3 py-2 text-[13px]">
          <span className="text-at-risk font-medium">Blocked:</span> {task.blockerNote}
        </p>
      ) : null}

      {delegator ? (
        <div className="mt-8 space-y-6">
          <TaskDefinitionForm task={task} />
          <ReassignForm task={task} assignees={assignees} />
          <WithdrawCard task={task} />
        </div>
      ) : (
        <p className="text-muted-foreground mt-8 rounded-lg border border-dashed p-4 text-[13px]">
          {task.assignedByName} owns the wording and the date on this task. You report
          progress from{" "}
          <Link href="/delegation" className="text-primary hover:underline">
            My tasks
          </Link>
          . Nobody is expected to hold themselves to a deadline they can move.
        </p>
      )}

      {moves.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Reassignment history</h2>
          <ul className="mt-2 space-y-1 text-[13px]">
            {moves.map((m, i) => (
              <li key={i} className="text-muted-foreground">
                {m.at.toLocaleDateString("en-IN")} ·{" "}
                <span className="text-foreground">
                  {names.get(m.fromUserId ?? "") ?? "someone"}
                </span>{" "}
                →{" "}
                <span className="text-foreground">
                  {names.get(m.toUserId ?? "") ?? "someone"}
                </span>
                {m.byUserId ? `, by ${names.get(m.byUserId) ?? "someone"}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
