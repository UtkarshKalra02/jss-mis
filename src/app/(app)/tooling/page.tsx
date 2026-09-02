import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { ToolingFilters, ToolingSearch } from "@/components/tooling/tooling-filters";
import { ToolingList } from "@/components/tooling/tooling-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { searchTooling } from "@/modules/tooling/queries";

export const metadata: Metadata = { title: "Job Kitting · JSS MIS" };

/**
 * The Job Kitting register (decisions I8, I10).
 *
 * The NAME is a label and nothing more (I10). This is not the BMP kitting
 * gate — the check that material, plate, die and artwork are all ready before
 * a job starts. That is a future checklist tied to a job card, recorded in
 * BACKLOG.md. This screen answers "where is the die".
 *
 * The question this screen answers, many times a day, is "where is the die for
 * X" — so location is searchable, is a column, and is the largest thing on the
 * phone card. Everything else on the row is context for confirming you have
 * found the right tool.
 *
 * Everyone can read it; ORDER_DESK and ADMIN can write (I9). FLOOR reads it on
 * a phone, which is why the results have a card layout at all.
 *
 * Search and filters live in the URL, so a filtered register is a link.
 */
export default async function ToolingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; condition?: string; status?: string }>;
}) {
  const user = await requireAccess("tooling");
  const canWrite = can(user.role, "tooling", "write");

  const { q = "", type = "", condition = "", status = "" } = await searchParams;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Job Kitting</h1>
        {canWrite ? (
          <Button asChild size="sm">
            <Link href="/tooling/new">Add tooling</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Plates, foil blocks, dies and embossing blocks. Search by tool number, name, location,
        client or design.
      </p>

      <div className="mt-6 space-y-4">
        <Suspense fallback={<Skeleton className="h-9 w-full max-w-lg" />}>
          <ToolingSearch initialQuery={q} />
        </Suspense>
        <Suspense fallback={null}>
          <ToolingFilters toolType={type} condition={condition} status={status} />
        </Suspense>
      </div>

      <div className="mt-6">
        <Suspense
          key={`${q}:${type}:${condition}:${status}`}
          fallback={<Skeleton className="h-96 w-full" />}
        >
          <Results query={q} toolType={type} condition={condition} status={status} />
        </Suspense>
      </div>
    </div>
  );
}

/** Split out so the search box stays live while this re-runs (section 7). */
async function Results({
  query,
  toolType,
  condition,
  status,
}: {
  query: string;
  toolType: string;
  condition: string;
  status: string;
}) {
  const tools = await searchTooling({ query, toolType, condition, status });
  return <ToolingList tools={tools} />;
}
