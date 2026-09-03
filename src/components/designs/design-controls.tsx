"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  deleteDesignAction,
  setDesignActiveAction,
  setDesignApprovalAction,
  type FormState,
} from "@/modules/designs/actions";

const initialState: FormState = { ok: false, error: null };

function Submit({
  label,
  variant,
}: {
  label: string;
  variant?: "outline" | "destructive" | "default";
}) {
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

/**
 * Approval is an action, not a form field (spec 6.5).
 *
 * It records who decided and when, which a dropdown buried among paper sizes
 * would not — somebody editing the GSM should not be able to approve the
 * artwork by accident on the way past.
 */
export function DesignApproval({
  designId,
  approvalStatus,
  approvedAt,
  approverName,
}: {
  designId: string;
  approvalStatus: string;
  approvedAt: Date | string | null;
  approverName: string | null;
}) {
  const [state, formAction] = useActionState(setDesignApprovalAction, initialState);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Approval</h2>

      <p className="text-muted-foreground mt-1 text-[13px]">
        {approvalStatus === "Approved" ? (
          <>
            Approved{approverName ? ` by ${approverName}` : ""} on{" "}
            {formatDateTime(approvedAt)}.
          </>
        ) : approvalStatus === "Rejected" ? (
          "Rejected. Nothing should go to plate until this is resolved."
        ) : (
          "Not yet approved."
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {approvalStatus !== "Approved" ? (
          <form action={formAction}>
            <input type="hidden" name="id" value={designId} />
            <input type="hidden" name="approvalStatus" value="Approved" />
            <Submit label="Approve" />
          </form>
        ) : null}

        {approvalStatus !== "Rejected" ? (
          <form action={formAction}>
            <input type="hidden" name="id" value={designId} />
            <input type="hidden" name="approvalStatus" value="Rejected" />
            <Submit label="Reject" variant="outline" />
          </form>
        ) : null}

        {approvalStatus !== "Pending" ? (
          <form action={formAction}>
            <input type="hidden" name="id" value={designId} />
            <input type="hidden" name="approvalStatus" value="Pending" />
            <Submit label="Back to pending" variant="outline" />
          </form>
        ) : null}
      </div>

      <Feedback state={state} />
    </section>
  );
}

export function DesignActiveToggle({
  designId,
  designCode,
  isActive,
}: {
  designId: string;
  designCode: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState(setDesignActiveAction, initialState);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">{isActive ? "Retire design" : "Reinstate design"}</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {isActive
          ? `${designCode} stays on every item that already uses it, but cannot be chosen for new ones.`
          : `${designCode} becomes selectable again on new PO items.`}
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={designId} />
        <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
        <Submit label={isActive ? "Retire" : "Reinstate"} variant="outline" />
      </form>

      <Feedback state={state} />
    </section>
  );
}

export function DesignDelete({
  designId,
  designCode,
}: {
  designId: string;
  designCode: string;
}) {
  const [state, formAction] = useActionState(deleteDesignAction, initialState);

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Remove design</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Soft delete — {designCode} and its route stop appearing anywhere, and every PO item
        that referenced it keeps working. Retiring is usually what you want; removing is for
        a design entered by mistake.
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={designId} />
        <Submit label="Remove" variant="destructive" />
      </form>

      <Feedback state={state} />
    </section>
  );
}
