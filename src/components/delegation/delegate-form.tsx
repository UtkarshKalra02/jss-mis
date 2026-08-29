"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { todayIST } from "@/lib/dates";
import { createTaskAction, type FormState } from "@/modules/delegation/actions";
import type { Assignee } from "@/modules/delegation/queries";
import { delegationLevels } from "@/modules/delegation/validation";

const initialState: FormState = { ok: false, error: null };

/** BMP week 12's ladder, spelled out — L2/L3/L4 means nothing on its own. */
const LEVEL_HELP: Record<(typeof delegationLevels)[number], string> = {
  L2: "Do exactly this and report back when it is done.",
  L3: "Look into it, recommend what to do, then act on the answer.",
  L4: "Decide and act. Tell me in the routine update, not before.",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Delegate task"}
    </Button>
  );
}

/**
 * The Delegate form.
 *
 * `expectedDate` is `required` and has no "not sure" option, because a task
 * without a date is not delegated — it is mentioned. The whole module produces
 * one number and that number is measured against this field.
 *
 * Who appears in the person list is decided on the SERVER and passed in: a
 * non-admin gets exactly themselves. The action re-checks it (canDelegateTo),
 * so the short list is a convenience and not the control.
 */
export function DelegateForm({
  assignees,
  viewerId,
  isAdmin,
}: {
  assignees: Assignee[];
  viewerId: string;
  isAdmin: boolean;
}) {
  const [state, formAction] = useActionState(createTaskAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <label className="block">
        <span className="text-[13px] font-medium">Who is it for?</span>
        {isAdmin ? (
          <select
            name="assignedTo"
            required
            defaultValue={viewerId}
            className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
          >
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.role.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="assignedTo" value={viewerId} />
            <p className="text-muted-foreground mt-1.5 text-[13px]">
              {assignees.find((a) => a.id === viewerId)?.name ?? "You"} — you can delegate to
              yourself. An admin delegates to anyone else.
            </p>
          </>
        )}
      </label>

      <label className="block">
        <span className="text-[13px] font-medium">What is the task?</span>
        <textarea
          name="task"
          required
          rows={3}
          maxLength={500}
          placeholder="Get the revised rate card out to the top ten clients"
          className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
        />
        <span className="text-muted-foreground mt-1 block text-[12px]">
          One task, one outcome. Something that is either done or not done by a date — not an
          ongoing responsibility.
        </span>
      </label>

      <label className="block">
        <span className="text-[13px] font-medium">Expected by</span>
        <input
          type="date"
          name="expectedDate"
          required
          min={todayIST()}
          defaultValue={todayIST()}
          className="border-input bg-background mt-1.5 h-9 rounded-md border px-2 text-[13px]"
        />
        <span className="text-muted-foreground mt-1 block text-[12px]">
          Required. A task without a date cannot be late, and cannot be scored.
        </span>
      </label>

      <fieldset>
        <legend className="text-[13px] font-medium">Delegation level</legend>
        <div className="mt-1.5 space-y-1.5">
          {delegationLevels.map((level, i) => (
            <label key={level} className="flex cursor-pointer items-start gap-2 text-[13px]">
              <input
                type="radio"
                name="level"
                value={level}
                defaultChecked={i === 0}
                className="accent-primary mt-1 size-3.5"
              />
              <span>
                <span className="font-medium">{level}</span>{" "}
                <span className="text-muted-foreground">{LEVEL_HELP[level]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Submit />
        {state.error ? (
          <p role="alert" className="text-overdue text-[13px]">
            {state.error}
          </p>
        ) : null}
        {state.ok && state.message ? (
          <p role="status" className="text-on-time text-[13px]">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
