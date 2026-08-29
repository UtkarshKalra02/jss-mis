"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateStatusAction, type FormState } from "@/modules/delegation/actions";
import { assigneeStatuses, delegatorStatuses } from "@/modules/delegation/permissions";
import type { TaskRow } from "@/modules/delegation/queries";

const initialState: FormState = { ok: false, error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

/**
 * How late, in words a person reads rather than a signed integer.
 *
 * Overdue is red, due today is amber, and everything else is quiet. Section 7
 * permits semantic colour only, and "3 days late" is exactly the semantic this
 * module exists to surface.
 */
function Due({ task }: { task: TaskRow }) {
  if (task.status === "Cancelled") {
    return <span className="text-muted-foreground">Withdrawn</span>;
  }

  if (task.status === "Done") {
    return task.daysLate > 0 ? (
      <span className="text-overdue">
        {task.daysLate} day{task.daysLate === 1 ? "" : "s"} late
      </span>
    ) : (
      <span className="text-on-time">On time</span>
    );
  }

  if (task.isOverdue) {
    return (
      <span className="text-overdue font-medium">
        {task.daysLate} day{task.daysLate === 1 ? "" : "s"} overdue
      </span>
    );
  }

  if (task.daysPastDue === 0) return <span className="text-at-risk font-medium">Due today</span>;

  const days = -task.daysPastDue;
  return (
    <span className="text-muted-foreground">
      in {days} day{days === 1 ? "" : "s"}
    </span>
  );
}

/**
 * One task, with the only three controls the assignee gets.
 *
 * There is no task-text input and no date input here, and their absence is the
 * feature. The server refuses those fields regardless (permissions.ts), but a
 * screen that offered them and then refused would be teaching the wrong thing
 * about who owns a deadline.
 */
function TaskCard({ task, viewerId, isAdmin }: { task: TaskRow; viewerId: string; isAdmin: boolean }) {
  const [state, formAction] = useActionState(updateStatusAction, initialState);
  const [status, setStatus] = useState(task.status);

  // The delegator's own list shows the full set; an assignee never sees
  // Cancelled, because withdrawing a task is not theirs to do (G3).
  const canCancel = isAdmin || task.assignedBy === viewerId;
  const statuses = canCancel ? delegatorStatuses() : assigneeStatuses();

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        task.isOverdue && "border-overdue/40",
        task.status === "Cancelled" && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{task.task}</p>
          <p className="text-muted-foreground mt-1 text-[12px]">
            {task.level} · from {task.assignedByName} · due {task.expectedDate} ·{" "}
            <Due task={task} />
          </p>
        </div>
        <Link
          href={`/delegation/${task.delegationTaskId}`}
          className="text-primary shrink-0 text-[12px] hover:underline"
        >
          Open
        </Link>
      </div>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={task.delegationTaskId} />

        <label className="text-[12px]">
          <span className="text-muted-foreground block">Status</span>
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {/* Rendered only when it is required, so the form asks for exactly what
            the rule needs rather than showing two fields that are usually
            irrelevant. The server enforces both regardless. */}
        {status === "Done" ? (
          <label className="text-[12px]">
            <span className="text-muted-foreground block">Finished on</span>
            <input
              type="date"
              name="completedAt"
              required
              defaultValue={task.completedAt ?? ""}
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
            />
          </label>
        ) : null}

        {status === "Blocked" ? (
          <label className="min-w-64 flex-1 text-[12px]">
            <span className="text-muted-foreground block">What is blocking it?</span>
            <input
              type="text"
              name="blockerNote"
              required
              defaultValue={task.blockerNote ?? ""}
              placeholder="Waiting on the client's artwork approval"
              className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-[13px]"
            />
          </label>
        ) : null}

        <Submit />
      </form>

      {state.error ? (
        <p role="alert" className="text-overdue mt-2 text-[13px]">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time mt-2 text-[13px]">
          {state.message}
        </p>
      ) : null}

      {task.status === "Blocked" && task.blockerNote ? (
        <p className="text-at-risk mt-2 text-[12px]">Blocked: {task.blockerNote}</p>
      ) : null}
    </div>
  );
}

export function TaskList({
  tasks,
  viewerId,
  isAdmin,
  emptyMessage,
}: {
  tasks: TaskRow[];
  viewerId: string;
  isAdmin: boolean;
  emptyMessage: string;
}) {
  if (tasks.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-[13px]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.delegationTaskId}
          task={task}
          viewerId={viewerId}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}
