"use client";

import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import Link from "next/link";

import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { PurchaseOrderRow } from "./queries";

/**
 * Column definitions for the PO grid.
 *
 * Status is the only coloured thing, and only where it means something is
 * wrong or finished — section 7 permits semantic colour and nothing else.
 * "Open" and "Partially Dispatched" are the ordinary states of a working
 * factory and get no colour at all.
 */
function toneForStatus(status: string): string {
  if (status === "Cancelled") return "text-muted-foreground line-through";
  if (status === "Closed") return "text-on-time";
  return "";
}

export const purchaseOrderColumns: LegacyColumnDef<PurchaseOrderRow>[] = [
  {
    accessorKey: "internalNo",
    header: "PO",
    meta: { filterable: true, width: "9rem" },
    cell: ({ row }) => (
      <Link
        href={`/purchase-orders/${row.original.id}`}
        className="text-primary font-medium tabular-nums hover:underline"
      >
        {row.original.internalNo}
      </Link>
    ),
  },
  {
    accessorKey: "clientCode",
    header: "Client",
    meta: { filterable: true, width: "7rem" },
    cell: ({ row }) => (
      <span title={row.original.clientName}>{row.original.clientCode}</span>
    ),
  },
  {
    accessorKey: "poNo",
    header: "Their PO no",
    meta: { filterable: true, width: "10rem" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.poNo ?? "—"}</span>
    ),
  },
  {
    accessorKey: "poDate",
    header: "PO date",
    meta: { width: "8rem" },
    cell: ({ row }) => formatDate(row.original.poDate),
  },
  {
    accessorKey: "itemCount",
    header: "Items",
    meta: { align: "right", width: "5rem" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span>,
  },
  {
    accessorKey: "openItems",
    header: "Open",
    meta: { align: "right", width: "5rem" },
    cell: ({ row }) => (
      <span className={cn("tabular-nums", row.original.openItems === 0 && "text-muted-foreground")}>
        {row.original.openItems}
      </span>
    ),
  },
  {
    accessorKey: "orderValue",
    header: "Value",
    meta: { align: "right", width: "8rem" },
    cell: ({ row }) => (
      <span className="tabular-nums">{formatINR(row.original.orderValue)}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { filterable: true, width: "10rem" },
    cell: ({ row }) => (
      <span className={cn(toneForStatus(row.original.status))}>{row.original.status}</span>
    ),
  },
];
