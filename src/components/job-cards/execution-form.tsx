"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { updateJobCardExecutionAction, type FormState } from "@/modules/job-cards/actions";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px] tabular-nums";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save run figures"}
    </Button>
  );
}

/**
 * The three fields transcribed back off the printed card.
 *
 * THIS FORM EXISTS BECAUSE THE PRINTED CARD IS NOT THE RECORD. Final quantity,
 * wastage and remarks are written by hand on the floor, on a sheet that leaves
 * these boxes blank on purpose (J4) because the numbers do not exist when it
 * goes out. Somebody types them back afterwards, and until they do the system
 * knows what was planned and not what ran.
 *
 * It writes those three columns and nothing else (J6). A person entering a
 * wastage figure a week later must not post the machine and the planned
 * quantity back with it — the copy in their browser may be older than the one
 * in the database.
 */
export function ExecutionForm({
  id,
  finalQty,
  wastageQty,
  executionRemarks,
  plannedQty,
}: {
  id: string;
  finalQty: number | null;
  wastageQty: number | null;
  executionRemarks: string | null;
  plannedQty: number | null;
}) {
  const [state, formAction] = useActionState(updateJobCardExecutionAction, initialState);

  const recorded = finalQty !== null || wastageQty !== null;

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="id" value={id} />

      <h2 className="text-sm font-medium">After the run</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {recorded
          ? "Transcribed from the printed card."
          : "Blank until somebody copies these off the printed card. The sheet goes to the floor without them — the numbers do not exist yet."}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-medium">Final quantity</span>
          <input
            type="number"
            name="finalQty"
            min={0}
            defaultValue={finalQty ?? ""}
            className={inputClass}
          />
          {/* No ceiling against planned_qty, in the form or the database: an
              over-run is ordinary, and a rule refusing the true number gets
              answered by typing a false one. */}
          <span className="text-muted-foreground mt-1 block text-[12px]">
            {plannedQty === null
              ? "What actually came off the press."
              : `Planned ${plannedQty.toLocaleString("en-IN")}. Over-runs are fine — record what ran.`}
          </span>
        </label>

        <label className="block">
          <span className="text-[13px] font-medium">Wastage</span>
          <input
            type="number"
            name="wastageQty"
            min={0}
            defaultValue={wastageQty ?? ""}
            className={inputClass}
          />
          <span className="text-muted-foreground mt-1 block text-[12px]">
            Sheets spoiled. Typed by hand — nothing measures this.
          </span>
        </label>
      </div>

      <label className="mt-4 block">
        <span className="text-[13px] font-medium">Remarks</span>
        <textarea
          name="executionRemarks"
          rows={3}
          maxLength={1000}
          defaultValue={executionRemarks ?? ""}
          className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
        />
      </label>

      <div className="mt-4 flex items-center gap-3">
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
