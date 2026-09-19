import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { DataTable } from "@/components/data-table/data-table";
import { CategoryFilter } from "@/components/materials/category-filter";
import { Button } from "@/components/ui/button";
import { stockColumns } from "@/modules/materials/columns";
import { listCategories, listStock } from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Materials · JSS MIS" };

/**
 * The store (section O): every material with what is in stock, from
 * v_material_stock. Materials that need reordering sort first.
 *
 * ADMIN, PLANNER and DATA_ENTRY write; OWNER reads.
 */
export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; removed?: string }>;
}) {
  const user = await requireAccess("material");
  const canWrite = can(user.role, "material", "write");

  const { category = "", removed } = await searchParams;
  const [rows, categories] = await Promise.all([
    listStock({ categoryId: category || undefined }),
    listCategories(),
  ]);

  const reorder = rows.filter((r) => r.needsReorder).length;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="page-title">Materials</h1>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
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

      <div className="mt-6">
        <CategoryFilter value={category} categories={categories} />
      </div>

      <div className="mt-4">
        <DataTable
          columns={stockColumns}
          data={rows}
          emptyMessage={
            canWrite
              ? "No materials yet. Add one, or import the stock sheet."
              : "No materials yet."
          }
        />
      </div>
    </div>
  );
}
