import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { MaterialSearch } from "@/components/materials/material-search";
import { StockList } from "@/components/materials/stock-list";
import { TypeTabs } from "@/components/materials/type-tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { paperColumns } from "@/modules/materials/columns";
import { countByType, listStock, paperCategoryId } from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Paper · JSS MIS" };

/**
 * Paper, on its own (P9).
 *
 * THE REASON IT IS NOT A TAB ON MATERIALS is that paper is not one category
 * among nine here — it is half the store, the thing every job card consumes,
 * and the only material anybody asks for by size and GSM rather than by name.
 * Sharing a screen with ink and floor cleaner meant the columns that matter
 * for paper had to fit around columns that do not.
 *
 * So the grid is paper-shaped: no Category column, and Finish where it was.
 * The tabs are PAPER TYPES — SBS, Duplex, Art, Kraft — because that is the
 * division the godown actually thinks in.
 *
 * Receiving, issuing and adjusting are unchanged and still span the whole
 * store: this split is about what is easy to read, not about what the store
 * is. The buttons point at the same forms Materials does.
 */
export default async function PaperPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string }>;
}) {
  const user = await requireAccess("material");
  const canWrite = can(user.role, "material", "write");

  const { type = "", q = "" } = await searchParams;

  const paperId = await paperCategoryId();
  if (!paperId) {
    // The category is seeded and its code is the SKU fragment, so this is a
    // store somebody has reconfigured rather than a bug to render around.
    return (
      <div>
        <h1 className="page-title">Paper</h1>
        <p className="text-muted-foreground mt-2 text-[13px]">
          No paper category is configured in the store, so there is nothing to show here.
          Paper is the category whose code is <code>P</code> — the letter every paper SKU
          starts with.
        </p>
      </div>
    );
  }

  const [rows, types] = await Promise.all([
    listStock({ categoryId: paperId, query: q }),
    countByType({ categoryId: paperId, query: q }),
  ]);

  const byType = type ? rows.filter((r) => r.typeId === type) : rows;
  const reorder = byType.filter((r) => r.needsReorder).length;
  const total = types.reduce((n, t) => n + t.n, 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="page-title">Paper</h1>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/materials/issue">Issue</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/materials/receive">Receive (GRN)</Link>
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Every board and sheet in the store, by type, size and GSM. Stock is received less
        issued, batch by batch — nothing here is typed in as a total.
        {reorder > 0
          ? ` ${reorder} below reorder level.`
          : ""}
      </p>

      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-9 w-full max-w-lg" />}>
          <MaterialSearch initialQuery={q} />
        </Suspense>
      </div>

      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-9 w-full" />}>
          <TypeTabs value={type} types={types} total={total} />
        </Suspense>
      </div>

      <div className="mt-4">
        <StockList
          rows={byType}
          columns={paperColumns}
          emptyMessage={
            q
              ? `No paper matches "${q}".`
              : "No paper in the store yet."
          }
        />
      </div>
    </div>
  );
}
