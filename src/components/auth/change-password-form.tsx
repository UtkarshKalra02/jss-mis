"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPasswordAction, type FormState } from "@/modules/users/actions";

const initialState: FormState = { ok: false, error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Change password"}
    </Button>
  );
}

export function ChangePasswordForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction] = useActionState(changeOwnPasswordAction, initialState);
  const router = useRouter();

  useEffect(() => {
    // On success the shell becomes reachable again, but this page sits outside
    // it — so navigate explicitly rather than waiting for a revalidation that
    // will not come.
    if (state.ok) router.replace(redirectTo);
  }, [state.ok, redirectTo, router]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      {state.error ? (
        <p role="alert" aria-live="polite" className="text-overdue text-sm">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
