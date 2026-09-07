"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { formatCommittedDate, formatQty } from "@/lib/format";
import { addCardItemAction, removeCardItemAction, type FormState } from "@/modules/job-cards/actions";
import type { JobCardItemRow, ReleasableRow } from "@/modules/job-cards/queries";

const initialState: FormState = { ok: false, error: null };

/**
 * The items one job card covers, and the controls to change them (J25).
 *
 * A card used to cover exactly one item and this panel did not exist. Repeat
 * work of the same printing meant a whole new card — the same paper, plate,
 * machine, colours and fabrication typed again — so the second item now goes on
 * the card that already describes the job.
 *
 * WHAT THIS PANEL DOES NOT TOUCH is the card's specification. Adding an item
 * changes the item list and nothing else, which is why it is its own form and
 * its own action: a plan edit must never carry an item list with it, for the
 * reason J6 keeps the run figures on a separate form — one submission quietly
 * posting a stale copy of the other half.
 *
 * Each item keeps its own committed date, its own stage history and its own
 * OTD. The card says what is printed together; it does not merge what is owed
 * separately, and the note under the table says so, because a shared card looks
 * like a shared deadline and is not one.
 */
export function CardItems({
  jobCardId,
  jcNo,
  items,
  addable,
  canWrite,
}: {
  jobCardId: string;
  jcNo: string;
  items: JobCardItemRow[];
  /** Open items that could be added. Excludes the ones already on the card. */
  addable: ReleasableRow[];
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);

  const clients = new Set(items.map((i) => i.clientCode));

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">
          {items.length === 1 ? "This card covers" : `This card covers ${items.length} items`}
          {clients.size > 1 ? (
            <span className="text-muted-foreground font-normal"> · {clients.size} clients</span>
          ) : null}
        </h2>

        {canWrite && !adding ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add another item
          </Button>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-1 text-[12px]">
        One printed card, one trip through the press. Each item keeps its own committed date,
        its own stages and its own delivery — the card is what they are printed on, not a
        shared deadline.
      </p>

      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="px-3">Item</th>
              <th className="px-3">Client</th>
              <th className="px-3">Committed</th>
              <th className="px-3 text-right">Ordered</th>
              <th className="px-3 text-right">On this card</th>
              {canWrite ? <th className="px-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.poItemId}>
                <td className="px-3">
                  <Link href={`/items/${i.poItemId}`} className="hover:underline">
                    <span className="tabular-nums">{i.itemCode}</span>{" "}
                    <span className="text-muted-foreground">{i.itemName}</span>
                  </Link>
                </td>
                <td className="px-3" title={i.clientName}>
                  {i.clientCode}
                </td>
                <td className="px-3">{formatCommittedDate(i.committedDate)}</td>
                <td className="text-muted-foreground px-3 text-right tabular-nums">
                  {formatQty(i.orderedQty)}
                </td>
                <td className="px-3 text-right tabular-nums">{formatQty(i.plannedQty)}</td>
                {canWrite ? (
                  <td className="px-3 text-right">
                    {/* The last item cannot go: a card covering nothing is a
                        numbered document describing no job, and its number is
                        already spent. The action refuses it too. */}
                    {items.length > 1 ? (
                      <RemoveItem jobCardId={jobCardId} poItemId={i.poItemId} code={i.itemCode} />
                    ) : (
                      <span className="text-muted-foreground text-[12px]">
                        the only item
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && adding ? (
        <AddItem
          jobCardId={jobCardId}
          jcNo={jcNo}
          addable={addable}
          onDone={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function AddItem({
  jobCardId,
  jcNo,
  addable,
  onDone,
}: {
  jobCardId: string;
  jcNo: string;
  addable: ReleasableRow[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(addCardItemAction, initialState);
  const [poItemId, setPoItemId] = useState("");

  useEffect(() => {
    if (state.ok) {
      setPoItemId("");
      onDone();
    }
  }, [state, onDone]);

  const chosen = addable.find((a) => a.poItemId === poItemId);

  if (addable.length === 0) {
    return (
      <p className="text-muted-foreground mt-3 rounded-md border border-dashed px-3 py-2 text-[13px]">
        Nothing else is open with quantity still to make.{" "}
        <button type="button" onClick={onDone} className="underline">
          Close
        </button>
      </p>
    );
  }

  return (
    <form action={formAction} className="bg-muted/40 mt-3 rounded-lg border p-3">
      <input type="hidden" name="jobCardId" value={jobCardId} />

      <p className="text-[13px] font-medium">Add an item to {jcNo}</p>
      <p className="text-muted-foreground mt-1 text-[12px]">
        It will be printed on this card and share its paper, plate and machine. It keeps its
        own committed date and moves through stages on its own.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-72 grow">
          <span className="text-muted-foreground text-xs">Item</span>
          <select
            name="poItemId"
            value={poItemId}
            onChange={(e) => setPoItemId(e.target.value)}
            required
            className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-[13px]"
          >
            <option value="">Choose an item…</option>
            {addable.map((a) => (
              <option key={a.poItemId} value={a.poItemId}>
                {a.itemCode} — {a.itemName} · {a.clientCode} · {formatQty(a.pendingQty)} to make
              </option>
            ))}
          </select>
        </label>

        <label className="w-40">
          <span className="text-muted-foreground text-xs">Quantity</span>
          <input
            type="number"
            name="plannedQty"
            min={1}
            inputMode="numeric"
            placeholder={chosen ? String(chosen.pendingQty) : "all of it"}
            className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-[13px]"
          />
        </label>

        <div className="flex items-center gap-2">
          <Submit label="Add to this card" />
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>

      {/* Said before the save, not after: this item's client is not the one
          already on the card. Normal on a shared sheet (H3) and never blocked,
          but worth reading twice. */}
      {state.error ? (
        <p role="alert" className="text-overdue mt-2 text-[13px]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function RemoveItem({
  jobCardId,
  poItemId,
  code,
}: {
  jobCardId: string;
  poItemId: string;
  code: string;
}) {
  const [state, formAction] = useActionState(removeCardItemAction, initialState);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="jobCardId" value={jobCardId} />
      <input type="hidden" name="poItemId" value={poItemId} />
      <button
        type="submit"
        className="text-muted-foreground hover:text-overdue text-[12px] hover:underline"
        aria-label={`Take ${code} off this card`}
      >
        Remove
      </button>
      {state.error ? <span className="text-overdue ml-2 text-[12px]">{state.error}</span> : null}
    </form>
  );
}
