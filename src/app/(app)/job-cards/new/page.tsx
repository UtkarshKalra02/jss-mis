import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { JobCardForm } from "@/components/job-cards/job-card-form";
import { JobCardSearch } from "@/components/job-cards/job-card-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { formatQty } from "@/lib/format";
import { designSelections, fabricationVocabulary } from "@/modules/fabrication/queries";
import { GangPicker } from "@/components/job-cards/gang-picker";
import { GangReleaseForm } from "@/components/job-cards/gang-release-form";
import { todayIST } from "@/lib/numbering";
import {
  machineOptions,
  releasableItems,
  releasableItemsByIds,
} from "@/modules/job-cards/queries";
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
  searchParams: Promise<{ q?: string; item?: string; items?: string }>;
}) {
  await requireAccess("job_card", "write");

  const { q = "", item, items } = await searchParams;

  /*
   * Three states, one route. `item` is the single release, unchanged and still
   * the overwhelming majority. `items` is the plate (J20). Neither is the
   * picker.
   */
  const gang = items
    ? items.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <div className={gang.length > 0 ? "max-w-5xl" : "max-w-4xl"}>
      <Link href="/job-cards" className="text-muted-foreground text-[13px] hover:underline">
        ← Job cards
      </Link>
      <h1 className="page-title mt-2">
        {gang.length > 0 ? "New job cards, one plate" : "New job card"}
      </h1>

      {gang.length > 0 ? (
        <Suspense fallback={<Skeleton className="mt-8 h-96 w-full" />}>
          <GangForm poItemIds={gang} />
        </Suspense>
      ) : item ? (
        <Suspense fallback={<Skeleton className="mt-8 h-96 w-full" />}>
          <CardForm poItemId={item} />
        </Suspense>
      ) : (
        <>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Choose the item this card is for. Overdue first, then whatever is committed
            soonest. Tick two or more to put them on one plate.
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

  /*
   * The rows and the selection live in a client component, because ticking
   * boxes is state. The QUERY stays here: what is releasable, and in what
   * order, is a server question and the picker must not get a second opinion
   * about it.
   */
  return <GangPicker items={items} />;
}

/**
 * The plate form (J20) — several items, one press run, one submit.
 *
 * The ids arrive in the URL, so they are re-read from the view here rather
 * than trusted: a tab left open while somebody dispatched one of them would
 * otherwise offer a job with nothing left to make. The action checks again
 * anyway, inside the transaction, which is where it actually matters.
 */
async function GangForm({ poItemIds }: { poItemIds: string[] }) {
  const [found, machines] = await Promise.all([
    releasableItemsByIds(poItemIds),
    machineOptions(),
  ]);

  // Presented in the order they were ticked, not the order the database
  // returned them, so the list reads the way the person built it.
  const items = poItemIds
    .map((id) => found.find((f) => f.poItemId === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));

  if (items.length < 2) {
    return (
      <p className="bg-at-risk-bg text-at-risk mt-6 rounded-md px-3 py-2 text-[13px]">
        A plate needs at least two open items, and fewer than two of those are still open.{" "}
        <Link href="/job-cards/new" className="underline">
          Choose again
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Each item gets its own job card. They are created together on one press run, which
        is what holds the paper, the plate and the machine they share.
      </p>

      <GangReleaseForm items={items} machines={machines} today={todayIST()} />
    </>
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
  /* The design's answers, where the item has a design at all — most do not,
     which is why the card answers the whole block itself (J24). Defaults. */
  const designFab = detail?.designId ? await designSelections(detail.designId) : new Map();

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
          fabricationOptions={vocabulary}
          designSelected={designFab}
          cardSelected={new Map()}
          recentRuns={runs}
          startOpen
        />
      </div>
    </>
  );
}
