"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { formatCommittedDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { mergePoItemsAction, type FormState } from "@/modules/purchase-orders/actions";
import type { SameNameGroup } from "@/modules/purchase-orders/queries";

const initialState: FormState = { ok: false, error: null };

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? "Merging…" : "Merge into one item"}
    </Button>
  );
}

/**
 * Folding same-named items on a PO into one (N4).
 *
 * THE PANEL EXISTS TO MAKE THE COST VISIBLE BEFORE THE CLICK, not to talk
 * anybody out of it. It shows what the merged item will say — the total, and
 * which promised date it will carry — and, when the dates differ, refuses to
 * proceed until somebody picks one and can see what the other was.
 *
 * A group with a delivery already recorded against it is shown but cannot be
 * merged: the absorbed item is soft-deleted, and a challan pointing at a row
 * nothing displays would be a delivery with nothing to read it against.
 */
function Group({ group }: { group: SameNameGroup }) {
  const [state, formAction] = useActionState(mergePoItemsAction, initialState);
  const survivor = group.items[0]!;
  const absorbed = group.items.slice(1);

  const [keptDate, setKeptDate] = useState(survivor.committedDate ?? "");
  const blocked = group.dispatched.length > 0;

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="survivorId" value={survivor.id} />
      {absorbed.map((i) => (
        <input key={i.id} type="hidden" name="absorbedId" value={i.id} />
      ))}
      {group.datesDiffer ? <input type="hidden" name="committedDate" value={keptDate} /> : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{group.itemName}</h3>
        <p className="text-muted-foreground text-[13px] tabular-nums">
          {group.items.length} items · {formatQty(group.orderedQty)} ordered in total
        </p>
      </div>

      <table className="data-grid mt-3 w-full">
        <thead>
          <tr>
            <th className="px-2">Item</th>
            <th className="px-2 text-right">Ordered</th>
            <th className="px-2 text-right">Sent</th>
            <th className="px-2">Committed</th>
            <th className="px-2"></th>
          </tr>
        </thead>
        <tbody>
          {group.items.map((i) => (
            <tr key={i.id}>
              <td className="px-2 tabular-nums">{i.itemCode}</td>
              <td className="px-2 text-right tabular-nums">{formatQty(i.orderedQty)}</td>
              <td
                className={cn(
                  "px-2 text-right tabular-nums",
                  i.dispatchedQty > 0 && "text-overdue",
                )}
              >
                {formatQty(i.dispatchedQty)}
              </td>
              <td className="px-2 whitespace-nowrap">{formatCommittedDate(i.committedDate)}</td>
              <td className="text-muted-foreground px-2 text-[11px]">
                {i.id === survivor.id ? "kept" : "folded in, then removed"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {blocked ? (
        <p className="text-overdue mt-3 text-[13px]">
          {group.dispatched.map((i) => i.itemCode).join(", ")} already{" "}
          {group.dispatched.length === 1 ? "has a delivery" : "have deliveries"} recorded.
          These cannot be merged — the challan would be left pointing at a removed item.
        </p>
      ) : group.datesDiffer ? (
        <fieldset className="mt-3">
          <legend className="text-[13px]">
            These promise different dates. The merged item keeps one of them; the other is
            not recorded anywhere afterwards, and on-time delivery for the whole{" "}
            {formatQty(group.orderedQty)} is measured against the one you pick.
          </legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {[...new Set(group.items.map((i) => i.committedDate ?? ""))].map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="radio"
                  name="keptDate"
                  checked={keptDate === d}
                  onChange={() => setKeptDate(d)}
                  className="accent-primary"
                />
                {formatCommittedDate(d || null)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-muted-foreground mt-3 text-[13px]">
          All of these promise {formatCommittedDate(survivor.committedDate)}, so the merged
          item keeps that date and nothing is lost but the separate rows.
        </p>
      )}

      {state.error ? (
        <p role="alert" className="text-overdue mt-3 text-[13px]">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time mt-3 text-[13px]">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3">
        <Submit disabled={blocked || (group.datesDiffer && !keptDate)} />
      </div>
    </form>
  );
}

export function MergeSameName({ groups }: { groups: SameNameGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">Items sharing a name</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        More than one item on this order has the same name. Merging folds them into the
        earliest one and removes the rest; quantities are added together.
      </p>
      <div className="mt-3 space-y-4">
        {groups.map((g) => (
          <Group key={g.itemName} group={g} />
        ))}
      </div>
    </section>
  );
}
