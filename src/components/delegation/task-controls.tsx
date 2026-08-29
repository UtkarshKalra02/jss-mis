"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  cancelTaskAction,
  reassignTaskAction,
  removeTaskAction,
  updateDefinitionAction,
  type FormState,
} from "@/modules/delegation/actions";
import type { Assignee, TaskRow } from "@/modules/delegation/queries";
import { delegationLevels } from "@/modules/delegation/validation";

const initialState: FormState = { ok: false, error: null };

function Submit({ label, variant }: { label: string; variant?: "outline" | "destructive" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-overdue mt-2 text-[13px]">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-on-time mt-2 text-[13px]">
        {state.message}
      </p>
    );
  }
  return null;
}

/**
 * The delegator's panel: what the task is, and when it is due.
 *
 * These two fields are the goalposts, and the reason they live on a separate
 * screen from the status control is that they belong to a different person.
 * The server refuses them for the assignee regardless (permissions.ts); putting
 * them here keeps the screen honest about who owns what.
 */
export function TaskDefinitionForm({ task }: { task: TaskRow }) {
  const [state, formAction] = useActionState(updateDefinitionAction, initialState);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">The task and its date</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Yours to change because you delegated it. {task.assignedToName} cannot — that
        separation is what makes the scorecard worth reading.
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="id" value={task.delegationTaskId} />

        <label className="block">
          <span className="text-[13px] font-medium">Task</span>
          <textarea
            name="task"
            required
            rows={3}
            maxLength={500}
            defaultValue={task.task}
            className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="text-[13px] font-medium">Expected by</span>
            <input
              type="date"
              name="expectedDate"
              required
              min={task.dateGiven}
              defaultValue={task.expectedDate}
              className="border-input bg-background mt-1.5 h-9 rounded-md border px-2 text-[13px]"
            />
          </label>

          <label className="block">
            <span className="text-[13px] font-medium">Level</span>
            <select
              name="level"
              defaultValue={task.level}
              className="border-input bg-background mt-1.5 h-9 rounded-md border px-2 text-[13px]"
            >
              {delegationLevels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Submit label="Save" variant="outline" />
        <Feedback state={state} />
      </form>
    </section>
  );
}

/**
 * Reassignment (decision G4).
 *
 * Offered only to the delegator and only while the task is unfinished. The
 * warning is not decoration: moving an open task moves its whole history, and
 * the person reading this screen is the only one who can decide that is honest.
 */
export function ReassignForm({
  task,
  assignees,
}: {
  task: TaskRow;
  assignees: Assignee[];
}) {
  const [state, formAction] = useActionState(reassignTaskAction, initialState);

  if (task.status === "Done") {
    return (
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Hand to somebody else</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Not available — this task is done. Moving a finished result onto somebody who did
          not do it would rewrite a score that has already been read out.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Hand to somebody else</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        The whole task moves, including how late it already is. Both names are recorded
        against the change, so the scorecard cannot be tidied by moving a task quietly.
      </p>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={task.delegationTaskId} />
        <label className="text-[12px]">
          <span className="text-muted-foreground block">New owner</span>
          <select
            name="assignedTo"
            defaultValue={task.assignedTo}
            className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
          >
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Submit label="Reassign" variant="outline" />
      </form>
      <Feedback state={state} />
    </section>
  );
}

/**
 * Withdraw and remove — two different statements, deliberately separate.
 *
 * Cancel says the task existed and is no longer wanted; it stays visible and
 * leaves the scorecard denominator (G3). Remove says it should never have been
 * typed. Neither is available to the assignee, and neither is available once
 * the task is Done — both would otherwise be routes to make a late result
 * disappear.
 */
export function WithdrawCard({ task }: { task: TaskRow }) {
  const [cancelState, cancelAction] = useActionState(cancelTaskAction, initialState);
  const [removeState, removeAction] = useActionState(removeTaskAction, initialState);

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Withdraw or remove</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Withdrawing keeps the task visible and takes it off the scorecard — it was asked for
        and then called off. Removing is for one typed by mistake. Neither is available to
        the person doing the work, and neither is available once it is done.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        {task.status !== "Cancelled" ? (
          <form action={cancelAction}>
            <input type="hidden" name="id" value={task.delegationTaskId} />
            <Submit label="Withdraw task" variant="outline" />
          </form>
        ) : null}

        <form
          action={removeAction}
          onSubmit={(e) => {
            if (!confirm("Remove this task? Use Withdraw if it was real and is no longer wanted.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={task.delegationTaskId} />
          <Submit label="Remove" variant="destructive" />
        </form>
      </div>

      <Feedback state={cancelState} />
      <Feedback state={removeState} />
    </section>
  );
}
