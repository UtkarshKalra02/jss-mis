"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAtRiskWindowAction, type FormState } from "@/modules/stages/actions";

const initialState: FormState = { ok: false, error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function AtRiskWindowForm({ current }: { current: number }) {
  const [state, formAction] = useActionState(saveAtRiskWindowAction, initialState);

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <div className="space-y-2">
        <Label htmlFor="atRiskWindowDays">At-risk window (days)</Label>
        <Input
          id="atRiskWindowDays"
          name="atRiskWindowDays"
          type="number"
          min={0}
          max={60}
          defaultValue={current}
          className="tabular-nums"
        />
        <p className="text-muted-foreground text-xs">
          An open item counts as at risk when its committed date falls within this many days
          and it has not reached READY.
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
