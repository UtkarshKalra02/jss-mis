"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  restorePettyCashEntryAction,
  voidPettyCashEntryAction,
  type FormState,
} from "@/modules/petty-cash/actions";

const initialState: FormState = { ok: false, error: null };

function PendingButton({
  label,
  busy,
  variant,
}: {
  label: string;
  busy: string;
  variant?: "destructive" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * Voids one entry.
 *
 * "Void", not "delete", on the button as well as in the code — the row stays
 * on the sheet struck through and leaves the balance (non-negotiable 7). The
 * confirm names the amount, because the one mistake this button can make is
 * being pressed on the row above or below the intended one.
 */
export function VoidEntry({ id, amount }: { id: string; amount: string }) {
  const [state, formAction] = useActionState(voidPettyCashEntryAction, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Void the ₹${amount} entry? It stays on the sheet, struck through.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <PendingButton label="Void" busy="Voiding…" variant="destructive" />
      {state.error ? (
        <span role="alert" className="text-overdue ml-2 text-xs">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/** Puts a voided entry back. The other half of CC2 — a mis-void needs a way out. */
export function RestoreEntry({ id, amount }: { id: string; amount: string }) {
  const [state, formAction] = useActionState(restorePettyCashEntryAction, initialState);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Put the ₹${amount} entry back into the balance?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <PendingButton label="Put back" busy="Working…" variant="outline" />
      {state.error ? (
        <span role="alert" className="text-overdue ml-2 text-xs">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
