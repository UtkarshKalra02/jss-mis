"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  removeJobCardAction,
  setJobCardStatusAction,
  type FormState,
} from "@/modules/job-cards/actions";
import { jobCardStatuses } from "@/modules/job-cards/validation";

const initialState: FormState = { ok: false, error: null };

function Submit({ label, variant }: { label: string; variant?: "destructive" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-overdue mt-2 text-[13px]">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-on-time mt-2 text-[13px]">
        {state.message}
      </p>
    );
  }
  return null;
}

/**
 * Where a card is, and the way back out of one raised by mistake.
 *
 * Two panels rather than one, because they answer different questions and the
 * cheap one must not sit next to the irreversible one. Status is an ordinary
 * edit somebody makes weekly; removal is for a row that should never have been
 * typed.
 *
 * CANCEL LIVES IN THE STATUS PANEL, not beside Remove. Cancelling a card is a
 * normal event — the plan changed, the client deferred, the job went onto
 * somebody else's plate — and it keeps the number and the history. Putting it
 * beside a destructive action would make people hesitate over the safe answer
 * and reach for the unsafe one (J12).
 */
export function JobCardStatusPanel({
  id,
  status,
  holdReason,
}: {
  id: string;
  status: string;
  holdReason: string | null;
}) {
  const [state, formAction] = useActionState(setJobCardStatusAction, initialState);
  const [next, setNext] = useState(status);

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="id" value={id} />

      <h2 className="text-sm font-medium">Status</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Cancelling keeps the card, its number and its history. It drops off the open list
        and stops counting as a card this item already has.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[13px] font-medium">Move to</span>
          <select
            name="status"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="border-input bg-background mt-1.5 h-9 rounded-md border px-2 text-[13px]"
          >
            {jobCardStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {/* The database has a CHECK requiring this, so the field appearing at
            exactly the moment it is needed is not decoration. */}
        {next === "On Hold" ? (
          <label className="block min-w-64 grow">
            <span className="text-[13px] font-medium">Why</span>
            <input
              name="holdReason"
              defaultValue={holdReason ?? ""}
              placeholder="Waiting on the party's board"
              className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
            />
          </label>
        ) : null}

        <Submit label={next === "Cancelled" ? "Cancel card" : "Save status"} variant="outline" />
      </div>

      <Feedback state={state} />
    </form>
  );
}

/**
 * Removal, worded to steer away from itself.
 *
 * A card whose job was dropped is `Cancelled` — that is a fact about the work
 * and belongs in the record. Removal says the ROW should never have been
 * typed, which is much rarer, and it takes the card off every screen. Same
 * distinction the tooling register draws between Scrapped and removed.
 */
export function RemoveJobCardCard({ id, jcNo }: { id: string; jcNo: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState(removeJobCardAction, initialState);

  // The page reads a row that has just gone (G11).
  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state.ok, state.redirectTo, router]);

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Remove this card</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Only for a card raised by mistake. If the job was planned and then dropped, cancel it
        instead — that keeps the number and the history. Removal is refused once run figures
        have been recorded, and while the card is on a press run.
      </p>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {jcNo} stays consumed either way. A number is never reissued: the sheet carrying it
        may already be lying on a press.
      </p>

      <form
        action={formAction}
        className="mt-3"
        onSubmit={(e) => {
          if (!confirm(`Remove ${jcNo}? Cancel it instead if the job was simply dropped.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        <Submit label="Remove job card" variant="destructive" />
        <Feedback state={state} />
      </form>
    </section>
  );
}
