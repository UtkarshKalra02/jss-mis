"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveAtRiskWindowAction,
  saveAutoCloseBelowAction,
  type FormState,
} from "@/modules/stages/actions";

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


/**
 * The residual below which a part-delivered item closes itself (T1).
 *
 * The help text says what ZERO does, because "0" in a threshold box is the
 * kind of value somebody types to mean "off" and then has to go and check. It
 * does mean off — no pending quantity is below zero — and saying so here is
 * cheaper than finding out.
 */
export function AutoCloseBelowForm({ current }: { current: number }) {
  const [state, formAction] = useActionState(saveAutoCloseBelowAction, initialState);

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <div className="space-y-2">
        <Label htmlFor="autoCloseBelow">Auto-close residuals under (pieces)</Label>
        <Input
          id="autoCloseBelow"
          name="autoCloseBelow"
          type="number"
          min={0}
          max={100000}
          defaultValue={current}
          className="tabular-nums"
        />
        <p className="text-muted-foreground text-xs">
          A part-delivered item with less than this many pieces still pending closes itself
          once its committed date falls in an earlier month. It never closes an item nothing
          has been delivered against. Zero switches the rule off.
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
