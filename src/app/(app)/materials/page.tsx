import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { Suspense } from "react";

import { CategoryTabs } from "@/components/materials/category-tabs";
import { MaterialSearch } from "@/components/materials/material-search";
import { StockList } from "@/components/materials/stock-list";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatDate, formatQty } from "@/lib/format";
import {
  countByCategory,
  listDueForIssue,
  listStock,
  paperCategoryId,
} from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Materials · JSS MIS" };

/**
 * The store, MINUS PAPER (section O, split at P9): ink, chemicals, adhesives,
 * coatings and consumables, from v_material_stock. Materials that need
 * reordering sort first.
 *
 * Paper is at /paper. Receiving, issuing, adjusting and the In/Out log still
 * span everything — this split is about what is easy to READ, not about what
 * the store is.
 *
 * ADMIN, PLANNER and DATA_ENTRY write; OWNER reads.
 */
export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; removed?: string }>;
}) {
  const user = await requireAccess("material");
  const canWrite = can(user.role, "material", "write");
  // The In/Out log is for checking on the store, so it is an admin's, not
  // the store's (P4).
  const canAudit = can(user.role, "admin", "write");

  const { category = "", q = "", removed } = await searchParams;

  // Paper has its own screen since P9, so it is not on this one. Resolved by
  // category code, never by name — see paperCategoryId.
  const paperId = (await paperCategoryId()) ?? undefined;

  const [rows, counts, due] = await Promise.all([
    listStock({ categoryId: category || undefined, excludeCategoryId: paperId, query: q }),
    // Counts respect the search but not the category, so the strip says where
    // a typed word's matches are rather than only what the open tab holds.
    countByCategory({ query: q, excludeCategoryId: paperId }),
    listDueForIssue(),
  ]);

  const total = counts.reduce((n, c) => n + c.n, 0);

  const reorder = rows.filter((r) => r.needsReorder).length;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="page-title">Materials</h1>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            {canAudit ? (
              <Button asChild size="sm" variant="ghost">
                <Link href="/materials/log">In/Out log</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href="/materials/adjust">Adjust</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/materials/issue">Issue</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/materials/receive">Receive (GRN)</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/materials/new">Add material</Link>
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Stock is what has been received less what has been issued, batch by batch — nothing
        here is typed in as a total.
        {reorder > 0
          ? ` ${reorder} material${reorder === 1 ? "" : "s"} below reorder level.`
          : ""}
      </p>

      {removed ? (
        <p role="status" className="text-on-time mt-3 text-sm">
          {removed}
        </p>
      ) : null}

      {/* The sheet's "Operations check — due for issue" (P2). An Interval
          item nobody has recorded issuing for longer than its interval:
          usually the floor took it and the ledger was not told. */}
      {due.length > 0 ? (
        <section className="mt-6 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Due for issue — check the floor</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Used on a cycle, but not issued since the date shown. Either it was used and not
            recorded, or the interval is wrong.
          </p>
          <div className="mt-3 overflow-x-auto">
          <table className="data-grid w-full">
            <thead>
              <tr>
                <th className="hidden px-2 sm:table-cell">SKU</th>
                <th className="px-2">Material</th>
                <th className="px-2 text-right">In stock</th>
                <th className="hidden px-2 sm:table-cell">Last issued</th>
                <th className="hidden px-2 text-right sm:table-cell">Every</th>
                <th className="px-2 text-right">Overdue by</th>
              </tr>
            </thead>
            <tbody>
              {due.map((r) => (
                <tr key={r.materialId}>
                  <td className="hidden px-2 whitespace-nowrap tabular-nums sm:table-cell">
                    <Link href={`/materials/${r.materialId}`} className="text-primary hover:underline">
                      {r.sku}
                    </Link>
                  </td>
                  <td className="px-2">
                    <Link href={`/materials/${r.materialId}`} className="hover:underline sm:pointer-events-none">
                      {r.name}
                    </Link>
                    <span className="text-muted-foreground block text-[11px] tabular-nums sm:hidden">{r.sku}</span>
                  </td>
                  <td className="px-2 text-right whitespace-nowrap tabular-nums">
                    {formatQty(r.closingStock)} {r.unit}
                  </td>
                  <td className="hidden px-2 sm:table-cell">{formatDate(r.lastIssueOn)}</td>
                  <td className="hidden px-2 text-right tabular-nums sm:table-cell">
                    {formatQty(r.issueIntervalDays)} d
                  </td>
                  <td className="text-at-risk px-2 text-right whitespace-nowrap tabular-nums">
                    {formatQty(Math.abs(Number(r.daysToIssue)))} d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ) : null}

      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-9 w-full max-w-lg" />}>
          <MaterialSearch initialQuery={q} />
        </Suspense>
      </div>

      {/* Below the search box, because the counts on it answer to whatever is
          typed there (P8). */}
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <CategoryTabs value={category} counts={counts} total={total} />
        </Suspense>
      </div>

      <div className="mt-4">
        <StockList
          rows={rows}
          emptyMessage={
            q
              ? `Nothing matches "${q}".`
              : canWrite
                ? "No materials yet. Add one, or import the stock sheet."
                : "No materials yet."
          }
        />
      </div>
    </div>
  );
}
