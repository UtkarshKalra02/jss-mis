"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteUserAction,
  setActiveAction,
  setPasswordAction,
  type FormState,
} from "@/modules/users/actions";

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
      <p role="alert" className="text-overdue mt-2 text-sm">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-on-time mt-2 text-sm">
        {state.message}
      </p>
    );
  }
  return null;
}

export function SetPasswordCard({
  userId,
  userName,
  isSelf,
}: {
  userId: string;
  userName: string;
  isSelf: boolean;
}) {
  const [state, formAction] = useActionState(setPasswordAction, initialState);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">
        {isSelf ? "Change your password" : "Set a temporary password"}
      </h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {isSelf
          ? "This takes effect immediately."
          : `Hand this to ${userName} in person. They will be asked to choose their own password the next time they sign in, so this one stops working straight away.`}
      </p>

      <form action={formAction} className="mt-4 max-w-sm space-y-3">
        <input type="hidden" name="id" value={userId} />

        <div className="space-y-2">
          <Label htmlFor="password">
            {isSelf ? "New password" : "Temporary password"}
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>

        <Submit label="Set password" variant="outline" />
        <Feedback state={state} />
      </form>
    </section>
  );
}

export function ActiveToggle({
  userId,
  userName,
  isActive,
  disabledReason,
}: {
  userId: string;
  userName: string;
  isActive: boolean;
  disabledReason: string | null;
}) {
  const [state, formAction] = useActionState(setActiveAction, initialState);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">{isActive ? "Deactivate account" : "Reactivate account"}</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {isActive
          ? `${userName} keeps their history but cannot sign in. This takes effect immediately, even if they are signed in right now.`
          : `${userName} will be able to sign in again with their existing password.`}
      </p>

      {disabledReason ? (
        <p className="text-muted-foreground mt-3 text-[13px] italic">{disabledReason}</p>
      ) : (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="id" value={userId} />
          <input type="hidden" name="isActive" value={String(!isActive)} />
          <Submit label={isActive ? "Deactivate" : "Reactivate"} variant="outline" />
          <Feedback state={state} />
        </form>
      )}
    </section>
  );
}

export function RemoveUserCard({
  userId,
  userName,
  disabledReason,
}: {
  userId: string;
  userName: string;
  disabledReason: string | null;
}) {
  const [state, formAction] = useActionState(deleteUserAction, initialState);

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Remove from the system</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {userName} disappears from lists, but nothing they entered is lost — stage events and
        audit history keep pointing at them. Their username becomes available again.
      </p>

      {disabledReason ? (
        <p className="text-muted-foreground mt-3 text-[13px] italic">{disabledReason}</p>
      ) : (
        <form
          action={formAction}
          className="mt-3"
          onSubmit={(e) => {
            if (!confirm(`Remove ${userName}? They will no longer be able to sign in.`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={userId} />
          <Submit label="Remove user" variant="destructive" />
          <Feedback state={state} />
        </form>
      )}
    </section>
  );
}
