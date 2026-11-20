"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addPettyCashEntryAction, type FormState } from "@/modules/petty-cash/actions";
import type { PettyCashHeadRow } from "@/modules/petty-cash/queries";
import { pettyCashDirections } from "@/modules/petty-cash/validation";

const initialState: FormState = { ok: false, error: null };

const selectClass =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Add entry"}
    </Button>
  );
}

/**
 * One movement of cash, in or out.
 *
 * THE DIRECTION DECIDES WHAT THE FORM ASKS FOR. On the way out it needs a head,
 * because the by-head total for the month is the whole reason the heads are a
 * fixed list; on the way in it must not have one, because a top-up is not a
 * spend and would otherwise land in that total. The box is REMOVED rather than
 * disabled for a top-up, so there is nothing to leave filled in from a previous
 * entry — which is also what makes the server's "money coming in has no head"
 * a message nobody should ever see.
 *
 * The date defaults to the sheet being looked at, not to today. Somebody
 * writing up Monday on Tuesday morning opens Monday's sheet and types; making
 * them correct the date on every row is how entries end up on the wrong day.
 */
export function AddEntryForm({
  heads,
  defaultDate,
  maxDate,
}: {
  heads: PettyCashHeadRow[];
  defaultDate: string;
  maxDate: string;
}) {
  const [state, formAction] = useActionState(addPettyCashEntryAction, initialState);
  const [direction, setDirection] = useState<(typeof pettyCashDirections)[number]>("Out");

  const isOut = direction === "Out";

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="direction">Direction</Label>
          <select
            id="direction"
            name="direction"
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as (typeof pettyCashDirections)[number])
            }
            className={selectClass}
          >
            {/* Read off the pgEnum, never typed here (non-negotiable 5). */}
            {pettyCashDirections.map((d) => (
              <option key={d} value={d}>
                {d === "In" ? "In — cash into the tin" : "Out — cash spent"}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="entryDate">Date the cash moved</Label>
          <Input
            id="entryDate"
            name="entryDate"
            type="date"
            required
            defaultValue={defaultDate}
            /* The database refuses a future date outright; the picker should
               not offer one in the first place. */
            max={maxDate}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            placeholder="350"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            Rupees. Commas are fine; the direction carries the sign, so never type a minus.
          </p>
        </div>

        {isOut ? (
          <div className="space-y-2">
            <Label htmlFor="headId">Spent on</Label>
            <select id="headId" name="headId" required className={selectClass}>
              <option value="">Choose…</option>
              {heads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="party">Received from</Label>
            <Input id="party" name="party" placeholder="Amit Sir" autoComplete="off" />
          </div>
        )}

        {isOut ? (
          <div className="space-y-2">
            <Label htmlFor="party">Paid to</Label>
            <Input id="party" name="party" placeholder="auto / tea stall / courier" autoComplete="off" />
          </div>
        ) : null}

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="purpose">What it was for</Label>
          <Input
            id="purpose"
            name="purpose"
            required
            placeholder="samples to Naraina for Nature Packaging"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            Write it so it still makes sense in a month. This is the line somebody reads when
            they ask where the money went.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Submit />
        {state.error ? (
          <p role="alert" className="text-overdue text-[13px]">
            {state.error}
          </p>
        ) : null}
        {state.ok && state.message ? (
          <p role="status" className="text-on-time text-[13px]">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
