"use client";

import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import Link from "next/link";

import { formatINR } from "@/lib/format";

import type { ClientRow } from "./queries";

/**
 * Column definitions for the client grid.
 *
 * Screens supply columns; the grid itself is written once in
 * components/data-table. Adding a column here is the whole cost of changing
 * what this table shows.
 */
export const clientColumns: LegacyColumnDef<ClientRow>[] = [
  {
    accessorKey: "code",
    header: "Code",
    meta: { filterable: true, width: "7rem" },
    cell: ({ row }) => (
      <Link
        href={`/clients/${row.original.id}`}
        className="text-primary font-medium hover:underline"
      >
        {row.original.code}
      </Link>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    meta: { filterable: true, width: "16rem" },
    cell: ({ row }) => (
      <span className={row.original.isActive ? "" : "text-muted-foreground"}>
        {row.original.name}
        {!row.original.isActive ? (
          <span className="text-muted-foreground ml-2 text-[11px]">(inactive)</span>
        ) : null}
        {/* F32. Visible on the WHOLE list, not only under the filter: an
            auto-created client has a generated code and no GSTIN, and somebody
            reading it in passing should know that before they trust it. */}
        {row.original.importBatchId && !row.original.importReviewedAt ? (
          <span className="text-at-risk ml-2 text-[11px]">(from import, unchecked)</span>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "city",
    header: "City",
    meta: { filterable: true, width: "9rem" },
    cell: ({ row }) => row.original.city ?? "—",
  },
  {
    accessorKey: "gstin",
    header: "GSTIN",
    meta: { width: "11rem" },
    cell: ({ row }) => (
      <span className="tabular">{row.original.gstin ?? "—"}</span>
    ),
  },
  {
    accessorKey: "contactName",
    header: "Contact",
    meta: { width: "10rem" },
    cell: ({ row }) => row.original.contactName ?? "—",
  },
  {
    // Its own column rather than a second line under Contact: rows are a fixed
    // 40px, so anything stacked breaks the rhythm of the grid.
    accessorKey: "contactPhone",
    header: "Phone",
    meta: { width: "9rem" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.contactPhone ?? "—"}</span>
    ),
  },
  {
    accessorKey: "paymentTermsDays",
    header: "Terms",
    meta: { align: "right", width: "6rem" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.paymentTermsDays}d</span>
    ),
  },
  {
    accessorKey: "creditLimit",
    header: "Credit limit",
    meta: { align: "right", width: "9rem" },
    // Blank means no limit set, which is different from a limit of zero.
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.creditLimit === null ? "—" : formatINR(row.original.creditLimit)}
      </span>
    ),
  },
  {
    accessorKey: "clientType",
    header: "Type",
    meta: { width: "6rem" },
  },
];
