"use client";

import { useActionState } from "react";

import { removeIssueAction, type FormState } from "@/modules/materials/actions";

import { Submit } from "./form-bits";

const initialState: FormState = { ok: false, error: null };

/**
 * Undo a mistaken issue. Soft delete; the view stops counting it and the
 * material is back. There is no edit — a wrong issue is removed and re-entered,
 * so the audit log shows two plain rows rather than one amended one.
 */
export function RemoveIssue({ issueId, materialId }: { issueId: string; materialId: string }) {
  const [state, formAction] = useActionState(removeIssueAction, initialState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={issueId} />
      <input type="hidden" name="materialId" value={materialId} />
      <Submit label="Remove" variant="outline" />
      {state.error ? <span className="text-overdue ml-2 text-[11px]">{state.error}</span> : null}
    </form>
  );
}
