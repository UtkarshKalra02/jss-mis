import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { JobCardForm } from "@/components/job-cards/job-card-form";
import { JobCardSearch } from "@/components/job-cards/job-card-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCommittedDate, formatDaysToCommitted, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { designSelections, fabricationVocabulary } from "@/modules/fabrication/queries";
import { machineOptions, releasableItems } from "@/modules/job-cards/queries";
import { recentRuns } from "@/modules/press-runs/queries";
import { getItemDetail } from "@/modules/items/queries";

export const metadata: Metadata = { title: "New job card · JSS MIS" };

/**
 * Raising a job card, in two steps: choose the item, then fill the card.
 *
 * THE ITEM COMES FIRST because a card without one is meaningless — one card
 * covers exactly one PO item (H1) and everything else on the sheet is derived
 * from it. The picker is the same list Stage Update shows, ordered the same
 * way: overdue first, then nearest commitment. Two screens that disagree about
 * what is urgent are two screens somebody has to reconcile in their head.
 *
 * Items that already have a card are listed, marked. A second card is a split
 * or repeat run and is legitimate (J3), so the count informs rather than
 * filters — and the form asks again before writing one.
 */
export default async function NewJobCardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; item?: string }>;
}) {
  await requireAccess("job_card", "write");

  const { q = "", item } = await searchParams;

  return (
    <div className="max-w-4xl">
      <Link href="/job-cards" className="text-muted-foreground text-[13px] hover:underline">
        ← Job cards
      </Link>
      <h1 className="page-title mt-2">New job card</h1>

      {item ? (
        <Suspense fallback={<Skeleton className="mt-8 h-96 w-full" />}>
          <CardForm poItemId={item} />
        </Suspense>
      ) : (
        <>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Choose the item this card is for. Overdue first, then whatever is committed
            soonest.
          </p>

          <div className="mt-6">
            <Suspense fallback={<Skeleton className="h-9 w-full max-w-lg" />}>
              <JobCardSearch initialQuery={q} />
            </Suspense>
          </div>

          <div className="mt-6">
            <Suspense key={q} fallback={<Skeleton className="h-96 w-full" />}>
              <ItemPicker query={q} />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
}

async function ItemPicker({ query }: { query: string }) {
  const items = await releasableItems(query);

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-[13px]">
        {query
          ? `Nothing matches "${query}".`
          : "No open items with quantity still owed. Capture a purchase order first."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="data-grid w-full">
        <thead>
          <tr>
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
            <tr key={i.poItemId}>
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
                  /* From the view. Working it out here would compare a date to
                     a JavaScript clock, which is the wrong day for four and a
                     half hours every night (C10). */
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
                  {/* Said plainly rather than hidden: a second card is allowed
                      and the form asks again before writing one (J3). */}
                  {i.cards > 0 ? `Raise another (${i.cards})` : "Raise card"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function CardForm({ poItemId }: { poItemId: string }) {
  const [items, machines, vocabulary, detail, runs] = await Promise.all([
    releasableItems(""),
    machineOptions(),
    fabricationVocabulary(),
    getItemDetail(poItemId),
    recentRuns(),
  ]);

  const item = items.find((i) => i.poItemId === poItemId);

  if (!item) {
    return (
      <p className="bg-at-risk-bg text-at-risk mt-6 rounded-md px-3 py-2 text-[13px]">
        That item is no longer open, or has nothing left to make.{" "}
        <Link href="/job-cards/new" className="underline">
          Choose another
        </Link>
        .
      </p>
    );
  }

  /*
   * The run-scope questions this item's design opens — new die or old, and so
   * on. Only options the DESIGN has are asked: the card cannot invent a
   * process the design does not do (J8).
   */
  const designFab = detail?.designId ? await designSelections(detail.designId) : new Map();
  const runOptions = vocabulary.filter((o) => o.valueScope === "Run" && designFab.has(o.id));

  return (
    <>
      <p className="text-muted-foreground mt-1 text-[13px]">
        <span className="tabular-nums">{item.itemCode}</span> — {item.itemName} ·{" "}
        {item.clientCode} · {formatQty(item.pendingQty)} still to make
        {item.cards > 0 ? (
          <span className="text-at-risk">
            {" "}
            · already has {item.cards} card{item.cards === 1 ? "" : "s"}
          </span>
        ) : null}{" "}
        ·{" "}
        <Link href="/job-cards/new" className="hover:underline">
          change item
        </Link>
      </p>

      <div className="mt-8">
        <JobCardForm
          mode="release"
          poItemId={item.poItemId}
          itemCode={item.itemCode}
          pendingQty={item.pendingQty}
          machines={machines}
          runOptions={runOptions}
          runSelected={new Map()}
          recentRuns={runs}
          startOpen
        />
      </div>
    </>
  );
}
