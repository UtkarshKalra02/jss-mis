"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { todayIST } from "@/lib/dates";
import {
  addJobCardToRunAction,
  createRunForJobCardAction,
  removeJobCardFromRunAction,
  removeRunAction,
  updateRunAction,
  type FormState,
} from "@/modules/press-runs/actions";
import type { PressRunRow, RunOption } from "@/modules/press-runs/queries";

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
 * "Add to press run", from wherever a job card is visible.
 *
 * Two paths in one control: join a recent run, or start a new one. They are one
 * component because they are one decision — somebody looking at a job card is
 * asking "is this going on a plate with something else", and making them choose
 * a screen first would be asking them to know the answer before the question.
 *
 * "RECENT runs", not "open runs". press_run has no status and this does not
 * pretend otherwise (H5).
 */
export function AddToRunControl({
  jobCardId,
  jcNo,
  runs,
}: {
  jobCardId: string;
  jcNo: string;
  runs: RunOption[];
}) {
  const router = useRouter();
  const [addState, addAction] = useActionState(addJobCardToRunAction, initialState);
  const [createState, createAction] = useActionState(createRunForJobCardAction, initialState);
  const [mode, setMode] = useState<"existing" | "new">(runs.length > 0 ? "existing" : "new");

  useEffect(() => {
    if (createState.ok && createState.redirectTo) router.push(createState.redirectTo);
  }, [createState.ok, createState.redirectTo, router]);

  return (
    <div className="mt-3 rounded-md border p-3">
      <p className="text-[13px] font-medium">Add {jcNo} to a press run</p>
      <p className="text-muted-foreground mt-1 text-[12px]">
        For jobs printed together on one plate. Items from different clients on the same run
        is normal and is the reason this exists.
      </p>

      {runs.length > 0 ? (
        <div className="mt-3 flex gap-4 text-[12px]">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              className="accent-primary size-3.5"
            />
            Join a recent run
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={mode === "new"}
              onChange={() => setMode("new")}
              className="accent-primary size-3.5"
            />
            Start a new one
          </label>
        </div>
      ) : null}

      {mode === "existing" && runs.length > 0 ? (
        <form action={addAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="jobCardId" value={jobCardId} />
          <label className="text-[12px]">
            <span className="text-muted-foreground block">Run</span>
            <select
              name="pressRunId"
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.runNo} · {r.runDate}
                  {r.machine ? ` · ${r.machine}` : ""} · {r.cardCount} job
                  {r.cardCount === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          <Submit label="Add to run" variant="outline" />
          <Feedback state={addState} />
        </form>
      ) : (
        <form action={createAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="jobCardId" value={jobCardId} />
          <label className="text-[12px]">
            <span className="text-muted-foreground block">Run date</span>
            <input
              type="date"
              name="runDate"
              required
              defaultValue={todayIST()}
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
            />
          </label>
          <label className="text-[12px]">
            <span className="text-muted-foreground block">Machine</span>
            <input
              type="text"
              name="machine"
              placeholder="optional"
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
            />
          </label>
          <Submit label="Start run" variant="outline" />
          <Feedback state={createState} />
        </form>
      )}
    </div>
  );
}

/** The run's own details. Free text machine, because no machine master exists. */
export function RunDetailsForm({ run }: { run: PressRunRow }) {
  const [state, formAction] = useActionState(updateRunAction, initialState);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Run details</h2>
      <form action={formAction} className="mt-3 space-y-4">
        <input type="hidden" name="id" value={run.id} />

        <div className="flex flex-wrap gap-4">
          <label className="text-[12px]">
            <span className="text-muted-foreground block">Run date</span>
            <input
              type="date"
              name="runDate"
              required
              defaultValue={run.runDate}
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
            />
          </label>
          <label className="text-[12px]">
            <span className="text-muted-foreground block">Machine</span>
            <input
              type="text"
              name="machine"
              defaultValue={run.machine ?? ""}
              placeholder="e.g. Komori 4-colour"
              className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
            />
          </label>
        </div>

        <label className="block text-[12px]">
          <span className="text-muted-foreground block">Notes</span>
          <textarea
            name="notes"
            rows={2}
            maxLength={500}
            defaultValue={run.notes ?? ""}
            className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-[13px]"
          />
        </label>

        <Submit label="Save" variant="outline" />
        <Feedback state={state} />
      </form>
    </section>
  );
}

/** Takes one job card off the run, back to the ordinary un-ganged state. */
export function RemoveFromRunButton({ jobCardId }: { jobCardId: string }) {
  const [state, formAction] = useActionState(removeJobCardFromRunAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="jobCardId" value={jobCardId} />
      <Submit label="Remove" variant="outline" />
      <Feedback state={state} />
    </form>
  );
}

/**
 * Removes the run itself, and only once it is empty.
 *
 * The server refuses a run that still has job cards on it; this says so before
 * the click rather than after, but the server is the enforcement.
 */
export function RemoveRunCard({ run, memberCount }: { run: PressRunRow; memberCount: number }) {
  const router = useRouter();
  const [state, formAction] = useActionState(removeRunAction, initialState);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state.ok, state.redirectTo, router]);

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Remove this run</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {memberCount > 0
          ? `Take the ${memberCount} job card${memberCount === 1 ? "" : "s"} off it first. Removing a run underneath its jobs would leave them pointing at something nothing displays.`
          : "Nothing is on this run. The number it was issued is not reused."}
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={run.id} />
        <Button type="submit" size="sm" variant="destructive" disabled={memberCount > 0}>
          Remove run
        </Button>
        <Feedback state={state} />
      </form>
    </section>
  );
}
