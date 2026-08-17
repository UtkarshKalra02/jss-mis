"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  deleteClientAction,
  setClientActiveAction,
  type FormState,
} from "@/modules/clients/actions";

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

export function ClientActiveToggle({
  clientId,
  clientName,
  isActive,
}: {
  clientId: string;
  clientName: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState(setClientActiveAction, initialState);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">
        {isActive ? "Deactivate client" : "Reactivate client"}
      </h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {isActive
          ? `${clientName} stays on existing orders and history, but cannot be chosen for new ones.`
          : `${clientName} becomes selectable again on new orders.`}
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={clientId} />
        <input type="hidden" name="isActive" value={String(!isActive)} />
        <Submit label={isActive ? "Deactivate" : "Reactivate"} variant="outline" />
        <Feedback state={state} />
      </form>
    </section>
  );
}

export function RemoveClientCard({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [state, formAction] = useActionState(deleteClientAction, initialState);

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Remove from the list</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {clientName} disappears from the client list, but nothing is deleted — their purchase
        orders, dispatches and invoices keep their history. The code becomes available again.
        Prefer deactivating unless the record was created by mistake.
      </p>

      <form
        action={formAction}
        className="mt-3"
        onSubmit={(e) => {
          if (!confirm(`Remove ${clientName} from the client list?`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={clientId} />
        <Submit label="Remove client" variant="destructive" />
        <Feedback state={state} />
      </form>
    </section>
  );
}
