"use client";

import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import Link from "next/link";

import { formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { DispatchRow } from "./queries";

/**
 * The challan grid.
 *
 * Cancelled is the only status coloured, because it is the only one that
 * changes what the numbers mean: a cancelled challan consumes no order
 * quantity, so its line count and pieces are shown but do not count.
 */
export const dispatchColumns: LegacyColumnDef<DispatchRow>[] = [
  {
    accessorKey: "challanNo",
    header: "Challan",
    meta: { filterable: true, width: "9rem" },
    cell: ({ row }) => (
      <Link
        href={`/dispatch/${row.original.id}`}
        className="text-primary font-medium tabular-nums hover:underline"
      >
        {row.original.challanNo}
      </Link>
    ),
  },
  {
    accessorKey: "clientCode",
    header: "Client",
    meta: { filterable: true, width: "7rem" },
    cell: ({ row }) => <span title={row.original.clientName}>{row.original.clientCode}</span>,
  },
  {
    accessorKey: "dispatchDate",
    header: "Dispatched",
    meta: { width: "9rem" },
    cell: ({ row }) => formatDate(row.original.dispatchDate),
  },
  {
    accessorKey: "lineCount",
    header: "Lines",
    meta: { align: "right", width: "5rem" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.lineCount}</span>,
  },
  {
    accessorKey: "totalQty",
    header: "Pieces",
    meta: { align: "right", width: "7rem" },
    cell: ({ row }) => <span className="tabular-nums">{formatQty(row.original.totalQty)}</span>,
  },
  {
    accessorKey: "vehicleNo",
    header: "Vehicle",
    meta: { filterable: true, width: "9rem" },
    cell: ({ row }) => row.original.vehicleNo ?? "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { filterable: true, width: "8rem" },
    cell: ({ row }) => (
      <span
        className={cn(
          row.original.status === "Cancelled" && "text-muted-foreground line-through",
        )}
      >
        {row.original.status}
      </span>
    ),
  },
];
