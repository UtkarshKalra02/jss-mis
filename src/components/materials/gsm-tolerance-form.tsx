"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGsmToleranceAction, type FormState } from "@/modules/materials/actions";

const initialState: FormState = { ok: false, error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

/** The one number behind "290 can also work for 300" (O2). */
export function GsmToleranceForm({ current }: { current: number }) {
  const [state, formAction] = useActionState(saveGsmToleranceAction, initialState);

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <div className="space-y-2">
        <Label htmlFor="gsmTolerancePct">Paper GSM tolerance (%)</Label>
        <Input
          id="gsmTolerancePct"
          name="gsmTolerancePct"
          type="number"
          min={0}
          max={50}
          step="0.5"
          defaultValue={current}
          className="tabular-nums"
        />
        <p className="text-muted-foreground text-xs">
          When a job card asks for a GSM, the paper picker also offers stock of the same type and
          size within this percentage, nearest first. At 5%, a 300 GSM job is offered 285–315.
          The planner still chooses.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Submit />
        {state.error ? (
          <p role="alert" className="text-overdue text-sm">
            {state.error}
          </p>
        ) : null}
        {state.ok && state.message ? (
          <p role="status" className="text-on-time text-sm">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
