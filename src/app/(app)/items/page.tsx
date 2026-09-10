import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { DataTable } from "@/components/data-table/data-table";
import { ItemSearch } from "@/components/items/item-search";
import { OpenOnlyToggle } from "@/components/items/open-only-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBanner } from "@/components/items/risk-filter";
import { itemColumns } from "@/modules/items/columns";
import { searchItems, type RiskFilter } from "@/modules/items/queries";

export const metadata: Metadata = { title: "Item tracker · JSS MIS" };

/**
 * Spec 6.4 — "the stop asking people screen".
 *
 * Every role can reach it, including FLOOR (decision B1): Ajay looking up an
 * item on his phone is exactly what it exists for.
 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string; risk?: string }>;
}) {
  await requireAccess("item_tracker");

  const { q = "", all, risk } = await searchParams;
  const openOnly = all !== "1";

  // Anything other than the two known values is treated as no filter, so a
  // mistyped URL shows the whole list rather than an empty one.
  const riskFilter: RiskFilter | undefined =
    risk === "overdue" || risk === "at-risk" ? risk : undefined;

  /*
   * The tracker's own filters, handed to the print route verbatim. Built from
   * the parsed values rather than passing searchParams through, so a mistyped
   * `risk` that the screen ignored cannot reach the sheet either.
   */
  /*
   * Only the search term travels to the report (K17). The report has its own
   * client, stage and date filters and is always pending work, so `all` and
   * `risk` have nothing to map onto — carrying them would produce a sheet
   * whose header described filters the panel could not show.
   */
  const printQuery = q ? `?q=${encodeURIComponent(q)}` : "";

  return (
    <div>
      <h1 className="page-title">Item tracker</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Search by item code, item name, client, PO number or job card number.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <Suspense fallback={<Skeleton className="h-9 w-full max-w-lg" />}>
          <ItemSearch initialQuery={q} />
        </Suspense>
        <div className="flex items-center gap-4">
          <Suspense fallback={null}>
            <OpenOnlyToggle openOnly={openOnly} />
          </Suspense>
          {/* Carries the filters through, so the sheet is what is on screen
              rather than a second, differently-filtered report (K16). */}
          <Link
            href={`/items/print${printQuery}`}
            className="text-primary text-[13px] hover:underline"
          >
            Print
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <Suspense
          key={`${q}:${openOnly}:${riskFilter ?? ""}`}
          fallback={<Skeleton className="h-96 w-full" />}
        >
          <Results query={q} openOnly={openOnly} risk={riskFilter} />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Split out so the search box stays interactive while this re-runs — §7 asks
 * for skeletons rather than a spinner over the whole page.
 */
async function Results({
  query,
  openOnly,
  risk,
}: {
  query: string;
  openOnly: boolean;
  risk?: RiskFilter;
}) {
  const items = await searchItems(query, { openOnly, risk });

  return (
    <div className="space-y-4">
      {/* Says what the filter is, and offers the way out of it. A grid that is
          quietly showing a subset is the one thing a tracker must not do. */}
      {risk ? <RiskBanner risk={risk} count={items.length} /> : null}

      <DataTable
        columns={itemColumns}
        data={items}
        emptyMessage={
          risk === "overdue"
            ? "Nothing is overdue. Every committed date still ahead of it, or already met."
            : risk === "at-risk"
              ? "Nothing at risk in the current window."
              : query
                ? `Nothing matches "${query}".`
                : openOnly
                  ? "No open items. Untick “Open items only” to include delivered and cancelled ones."
                  : "No items yet. They appear here as purchase orders are captured."
        }
      />
    </div>
  );
}
