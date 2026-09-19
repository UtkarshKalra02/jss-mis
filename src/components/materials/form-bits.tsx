"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type { FormState } from "@/modules/materials/actions";

/** Shared pieces of the store's forms — one Submit, one Feedback, one redirect. */

export const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

export function Submit({
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

export function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-overdue mt-3 text-sm">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-on-time mt-3 text-sm">
        {state.message}
      </p>
    );
  }
  return null;
}

/** Follows `redirectTo` once the action has succeeded (G11 shape). */
export function useRedirectOnSuccess(state: FormState) {
  const router = useRouter();
  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);
}
