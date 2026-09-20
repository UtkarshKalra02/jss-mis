"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAdcWindowAction, type FormState } from "@/modules/materials/actions";

const initialState: FormState = { ok: false, error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

/** The window a material's daily consumption is averaged over (P2). */
export function AdcWindowForm({ current }: { current: number }) {
  const [state, formAction] = useActionState(saveAdcWindowAction, initialState);

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <div className="space-y-2">
        <Label htmlFor="adcWindowDays">Consumption window (days)</Label>
        <Input
          id="adcWindowDays"
          name="adcWindowDays"
          type="number"
          min={7}
          max={365}
          defaultValue={current}
          className="tabular-nums"
        />
        <p className="text-muted-foreground text-xs">
          A material&rsquo;s daily consumption is what was issued over this many days, divided by
          the days. Days remaining, max level and the reorder flags follow from it. The sheet
          averaged over everything since January; a window keeps the figure current.
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
