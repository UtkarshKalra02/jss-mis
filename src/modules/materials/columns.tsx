"use client";

import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import Link from "next/link";

import { formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { StockRow } from "./queries";
import { statusTone } from "./status";

/**
 * The stock grid (section O, statuses from P2).
 *
 * Semantic colour only: red for Critical, amber for Order now / Low and for
 * an Interval item that is due. Closing stock is never coloured — a low
 * number is only a problem relative to how fast it goes, and the status is
 * where that judgement lives.
 */

export const stockColumns: LegacyColumnDef<StockRow>[] = [
  {
    accessorKey: "sku",
    header: "SKU",
    meta: { filterable: true, width: "8rem" },
    cell: ({ row }) => (
      <Link
        href={`/materials/${row.original.materialId}`}
        className="text-primary font-medium tabular-nums hover:underline"
      >
        {row.original.sku}
      </Link>
    ),
  },
  {
    accessorKey: "name",
    header: "Material",
    meta: { filterable: true, width: "18rem" },
    cell: ({ row }) => (
      <span className={cn(!row.original.isActive && "text-muted-foreground line-through")}>
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "categoryName",
    header: "Category",
    meta: { filterable: true, width: "7rem" },
  },
  {
    accessorKey: "typeName",
    header: "Type",
    meta: { filterable: true, width: "8rem" },
  },
  {
    accessorKey: "size",
    header: "Size",
    meta: { filterable: true, width: "6rem" },
    cell: ({ row }) => row.original.size ?? "—",
  },
  {
    accessorKey: "gsm",
    header: "GSM",
    meta: { align: "right", width: "5rem" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.gsm ?? "—"}</span>,
  },
  {
    accessorKey: "closingStock",
    header: "In stock",
    meta: { align: "right", width: "7rem" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatQty(row.original.closingStock)}
        <span className="text-muted-foreground ml-1 text-[11px]">{row.original.unit}</span>
      </span>
    ),
  },
  {
    accessorKey: "inTransitQty",
    header: "In transit",
    meta: { align: "right", width: "6rem" },
    cell: ({ row }) => (
      <span
        className={cn("tabular-nums", Number(row.original.inTransitQty) === 0 && "text-muted-foreground")}
      >
        {formatQty(row.original.inTransitQty)}
      </span>
    ),
  },
  {
    accessorKey: "daysRemaining",
    header: "Days left",
    meta: { align: "right", width: "6rem" },
    cell: ({ row }) => (
      <span className={cn("tabular-nums", row.original.needsReorder && "text-at-risk")}>
        {row.original.daysRemaining === null ? "—" : formatQty(row.original.daysRemaining)}
      </span>
    ),
  },
  {
    accessorKey: "orderByDate",
    header: "Order by",
    meta: { width: "7rem" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.orderByDate ? formatDate(row.original.orderByDate) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "suggestedOrderQty",
    header: "Suggested",
    meta: { align: "right", width: "6.5rem" },
    cell: ({ row }) => (
      <span className={cn("tabular-nums", Number(row.original.suggestedOrderQty) === 0 && "text-muted-foreground")}>
        {formatQty(row.original.suggestedOrderQty)}
      </span>
    ),
  },
  {
    accessorKey: "stockStatus",
    header: "Status",
    meta: { filterable: true, width: "11rem" },
    cell: ({ row }) => (
      <span className={statusTone(row.original.stockStatus)}>
        {row.original.stockStatus}
        {row.original.reorderNote ? (
          <span className="text-muted-foreground ml-1 text-[11px]">· {row.original.reorderNote}</span>
        ) : null}
        {row.original.dueForIssue ? (
          <span className="text-at-risk ml-1 text-[11px]">· due for issue</span>
        ) : null}
      </span>
    ),
  },
];

/* -------------------------------------------------------------------------- */
/* The paper grid (P9)                                                         */
/* -------------------------------------------------------------------------- */

const byKey = (key: string) =>
  stockColumns.find((c) => "accessorKey" in c && c.accessorKey === key)!;

/**
 * Paper, on its own screen.
 *
 * Two differences from the store's grid, and both are the point of splitting
 * them. CATEGORY IS GONE — every row is paper, so a column repeating that
 * word 221 times is a column of noise. FINISH IS HERE — cream, white, gray
 * back — because with type, size and GSM equal it is the only thing left that
 * tells two papers apart, and on the store's grid it was nowhere.
 *
 * The cells are the store grid's own, picked by key rather than rewritten:
 * how a quantity or a status renders is one decision, and it should not start
 * drifting between two screens.
 */
export const paperColumns: LegacyColumnDef<StockRow>[] = [
  byKey("sku"),
  byKey("name"),
  byKey("typeName"),
  byKey("size"),
  byKey("gsm"),
  {
    accessorKey: "finish",
    header: "Finish",
    meta: { filterable: true, width: "7rem" },
    cell: ({ row }) => row.original.finish ?? "—",
  },
  byKey("closingStock"),
  byKey("inTransitQty"),
  byKey("daysRemaining"),
  byKey("orderByDate"),
  byKey("suggestedOrderQty"),
  byKey("stockStatus"),
];
