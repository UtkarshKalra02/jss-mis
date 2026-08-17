"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUserAction, updateUserAction, type FormState } from "@/modules/users/actions";

const initialState: FormState = { ok: false, error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

const selectClass =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

export function UserForm({
  mode,
  user,
}: {
  mode: "create" | "edit";
  user?: { id: string; username: string; name: string; email: string | null; role: string };
}) {
  const [state, formAction] = useActionState(
    mode === "create" ? createUserAction : updateUserAction,
    initialState,
  );

  return (
    <form action={formAction} className="max-w-md space-y-4">
      {mode === "edit" ? <input type="hidden" name="id" value={user!.id} /> : null}

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        {mode === "create" ? (
          <>
            <Input
              id="username"
              name="username"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="e.g. punit"
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, numbers, dot, underscore or hyphen. Cannot be changed later.
            </p>
          </>
        ) : (
          <>
            <Input id="username" value={user!.username} disabled />
            {/* Usernames are immutable: audit rows and stage events are read
                by username in practice, and renaming would quietly rewrite who
                appears to have done past work. */}
            <p className="text-muted-foreground text-xs">
              Usernames cannot be changed. Remove the account and add a new one instead.
            </p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" required defaultValue={user?.name ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email (optional)</Label>
        <Input id="email" name="email" type="email" defaultValue={user?.email ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          defaultValue={user?.role ?? "ORDER_DESK"}
          className={selectClass}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r as Role]}
            </option>
          ))}
        </select>
      </div>

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

      <Submit label={mode === "create" ? "Add user" : "Save changes"} />
    </form>
  );
}
