import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { JobCardSearch, OpenCardsToggle } from "@/components/job-cards/job-card-filters";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchJobCards } from "@/modules/job-cards/queries";

export const metadata: Metadata = { title: "Job cards · JSS MIS" };

/**
 * The job card list.
 *
 * THIS SCREEN EXISTS BECAUSE THE ACTION WAS UNFINDABLE. Releasing a card began
 * life inside the Item Tracker's job cards panel — decision H6, written when
 * nothing in the system created a card and there was genuinely no screen to
 * hang it off. The result was that the one document the floor works from every
 * day took four clicks and prior knowledge to reach: search an item, open it,
 * scroll past the timeline and the dispatches, and find a button.
 *
 * A printed job card is a first-class document in a printing works. It gets a
 * first-class place. H6's reasoning expired the moment J1 made cards real.
 *
 * The Item Tracker panel stays — looking at an item and deciding to release it
 * is a real path, and the two call the same action.
 */
export default async function JobCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const user = await requireAccess("job_card");
  const canWrite = can(user.role, "job_card", "write");

  const { q = "", all } = await searchParams;
  const openOnly = all !== "1";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Job cards</h1>
        {canWrite ? (
          <Button asChild size="sm">
            <Link href="/job-cards/new">New job card</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        The sheet the floor works from. Search by card number, item, client or machine.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <Suspense fallback={<Skeleton className="h-9 w-full max-w-lg" />}>
          <JobCardSearch initialQuery={q} />
        </Suspense>
        <Suspense fallback={null}>
          <OpenCardsToggle openOnly={openOnly} />
        </Suspense>
      </div>

      <div className="mt-6">
        <Suspense key={`${q}:${openOnly}`} fallback={<Skeleton className="h-96 w-full" />}>
          <Results query={q} openOnly={openOnly} canWrite={canWrite} />
        </Suspense>
      </div>
    </div>
  );
}

async function Results({
  query,
  openOnly,
  canWrite,
}: {
  query: string;
  openOnly: boolean;
  canWrite: boolean;
}) {
  const cards = await searchJobCards(query, { openOnly });

  if (cards.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-[13px]">
        {query
          ? `Nothing matches "${query}".`
          : openOnly
            ? "No open job cards. Untick “Open cards only” to include completed and cancelled ones."
            : canWrite
              ? "No job cards yet. Raise the first one — that is what sends a job to the floor."
              : "No job cards yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="data-grid w-full">
        <thead>
          <tr>
            <th className="px-3">Card</th>
            <th className="px-3">Item</th>
            <th className="px-3">Client</th>
            <th className="px-3">Planned</th>
            <th className="px-3">Machine</th>
            <th className="px-3 text-right">To run</th>
            <th className="px-3 text-right">Ran</th>
            <th className="px-3">Status</th>
            <th className="px-3" />
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id}>
              <td className="px-3 tabular-nums">
                <Link href={`/job-cards/${c.id}`} className="text-primary hover:underline">
                  {c.jcNo}
                </Link>
              </td>
              <td className="px-3">
                <span className="tabular-nums">{c.itemCode}</span>{" "}
                <span className="text-muted-foreground">{c.itemName}</span>
              </td>
              <td className="px-3" title={c.clientName}>
                {c.clientCode}
              </td>
              <td className="px-3">{formatDate(c.plannedDate)}</td>
              <td className="text-muted-foreground px-3">{c.machineName ?? "—"}</td>
              <td className="px-3 text-right tabular-nums">{formatQty(c.plannedQty)}</td>
              {/* An em dash means nobody has transcribed the run yet, which is
                  a different statement from a zero (J4). */}
              <td className="px-3 text-right tabular-nums">{formatQty(c.finalQty)}</td>
              <td
                className={cn(
                  "px-3",
                  c.status === "On Hold" && "text-at-risk",
                  c.status === "Cancelled" && "text-muted-foreground",
                  c.status === "Completed" && "text-on-time",
                )}
              >
                {c.status}
              </td>
              <td className="px-3">
                <Link
                  href={`/job-cards/${c.id}/print`}
                  className="text-muted-foreground text-[12px] hover:underline"
                >
                  Print
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
