"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatCommittedDate, formatDaysToCommitted, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReleasableRow } from "@/modules/job-cards/queries";

/**
 * The item picker on /job-cards/new, with selection (J20).
 *
 * ONE LIST, TWO WAYS OUT. "Raise card" per row is the single release and is
 * unchanged — it is the overwhelming majority and must not become two clicks.
 * Ticking two or more reveals the plate, because that is the case that used to
 * mean one pass through the form per item.
 *
 * A tick of one offers nothing: a plate holding one job is an ordinary release
 * and the single form does it better, which is the same threshold H8 uses
 * before it collapses a run on Stage Update.
 */
export function GangPicker({ items }: { items: ReleasableRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = items.filter((i) => selected.has(i.poItemId));
  const clients = new Set(chosen.map((i) => i.clientCode));
  const enough = chosen.length >= 2;

  return (
    <>
      {/* The bar is always present once anything is ticked, so the count is
          visible before the button becomes usable — otherwise ticking one item
          looks like nothing happened. */}
      {selected.size > 0 ? (
        <div className="bg-muted/40 mb-3 flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <Layers className="text-muted-foreground size-4 shrink-0" />
          <span className="text-[13px]">
            {selected.size} selected
            {clients.size > 1 ? (
              <span className="text-muted-foreground">
                {" "}
                · {clients.size} clients
              </span>
            ) : null}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setSelected(new Set())}>
              Clear
            </Button>

            {enough ? (
              <Button asChild size="sm">
                <Link href={`/job-cards/new?items=${chosen.map((i) => i.poItemId).join(",")}`}>
                  Put {selected.size} on one plate
                </Link>
              </Button>
            ) : (
              <span className="text-muted-foreground text-[12px]">
                Tick one more — a plate needs at least two jobs.
              </span>
            )}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="w-10 px-3" />
              <th className="px-3">Item</th>
              <th className="px-3">Client</th>
              <th className="px-3">PO</th>
              <th className="px-3 text-right">To make</th>
              <th className="px-3">Stage</th>
              <th className="px-3">Committed</th>
              <th className="px-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.poItemId} className={cn(selected.has(i.poItemId) && "bg-muted/50")}>
                <td className="px-3">
                  <input
                    type="checkbox"
                    checked={selected.has(i.poItemId)}
                    onChange={() => toggle(i.poItemId)}
                    className="accent-primary size-4"
                    aria-label={`Put ${i.itemCode} on a shared plate`}
                  />
                </td>
                <td className="px-3">
                  <span className="tabular-nums">{i.itemCode}</span>{" "}
                  <span className="text-muted-foreground">{i.itemName}</span>
                </td>
                <td className="px-3" title={i.clientName}>
                  {i.clientCode}
                </td>
                <td className="px-3 tabular-nums">{i.poInternalNo}</td>
                <td className="px-3 text-right tabular-nums">{formatQty(i.pendingQty)}</td>
                <td className="text-muted-foreground px-3">{i.currentStageName ?? "—"}</td>
                <td className={cn("px-3", i.isOverdue && "text-overdue")}>
                  {formatCommittedDate(i.committedDate)}
                  {i.committedDate ? (
                    <span className="ml-2 text-[11px] opacity-80">
                      {formatDaysToCommitted(i.daysToCommitted)}
                    </span>
                  ) : null}
                </td>
                <td className="px-3">
                  <Link
                    href={`/job-cards/new?item=${i.poItemId}`}
                    className="text-primary text-[13px] hover:underline"
                  >
                    {/* Said plainly rather than hidden: a second card is
                        allowed and the form asks again before writing one (J3). */}
                    {i.cards > 0 ? `Raise another (${i.cards})` : "Raise card"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
