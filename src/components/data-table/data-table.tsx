"use client";

import { flexRender } from "@tanstack/react-table";
import type { RowData } from "@tanstack/table-core";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import "./types";

/**
 * THE grid. Dense data tables are the product (section 7), so the density
 * contract is implemented once here and every screen supplies column
 * definitions rather than a new table:
 *
 *   40px rows · sticky header · zebra OFF · hover highlight · sortable
 *   headers · inline per-column search · 50 rows per page · tabular numerals
 *
 * Built on TanStack's `/legacy` entrypoint, which is the v8-shaped API carried
 * forward into v9. The v9 native API (atoms, stores, granular Subscribe) is
 * more powerful but a much larger mental model, and almost every example and
 * answer you will find online is written against this one. Migrating later is
 * a change to this file alone, which is the whole reason the grid is written
 * once.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage = "Nothing to show.",
  pageSize = 50,
}: {
  columns: LegacyColumnDef<TData>[];
  data: TData[];
  emptyMessage?: string;
  pageSize?: number;
}) {
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const [columnFilters, setColumnFilters] = useState<{ id: string; value: unknown }[]>([]);

  const table = useLegacyTable<TData>({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  const rows = table.getRowModel().rows;
  const filtered = table.getFilteredRowModel().rows.length;
  const total = data.length;
  const pageCount = table.getPageCount();

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      style={meta?.width ? { width: meta.width } : undefined}
                      className={cn(
                        "px-3 whitespace-nowrap",
                        meta?.align === "right" && "text-right",
                      )}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors",
                            meta?.align === "right" && "flex-row-reverse",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-30" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}

                      {/* Inline column search, section 7. Only on columns that
                          ask for it — a filter box under every header is noise. */}
                      {meta?.filterable ? (
                        <input
                          type="search"
                          value={(header.column.getFilterValue() as string) ?? ""}
                          onChange={(e) => header.column.setFilterValue(e.target.value)}
                          placeholder="Filter…"
                          aria-label={`Filter by ${header.column.id}`}
                          // `block` is load-bearing: the header cell is
                          // whitespace-nowrap to keep rows at 40px, which
                          // would otherwise flow this input inline beside the
                          // column label instead of beneath it.
                          className="border-input bg-background placeholder:text-muted-foreground/50 mt-1 mb-1.5 block h-6 w-full rounded border px-1.5 text-[12px] font-normal"
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllLeafColumns().length}
                  className="text-muted-foreground px-3 py-10 text-center"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          // Rows stay exactly 40px (section 7). Content that
                          // does not fit scrolls horizontally in the wrapper
                          // rather than wrapping and breaking the rhythm of
                          // the grid.
                          "truncate px-3 whitespace-nowrap",
                          meta?.align === "right" && "text-right",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-muted-foreground mt-3 flex items-center justify-between text-[12px]">
        <span>
          {filtered === total
            ? `${total} ${total === 1 ? "row" : "rows"}`
            : `${filtered} of ${total} rows`}
        </span>

        {pageCount > 1 ? (
          <div className="flex items-center gap-3">
            <span className="tabular-nums">
              Page {table.getState().pagination.pageIndex + 1} of {pageCount}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="hover:bg-muted rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="hover:bg-muted rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
