"use client";

import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import Link from "next/link";

import { cn } from "@/lib/utils";

import type { DesignRow } from "./queries";

/**
 * Column definitions for the design grid.
 *
 * Colour follows section 7: semantic only, never decorative. A die that has
 * not arrived and a rejected design are the two things on this screen somebody
 * needs to spot without reading, so those are the only two things coloured.
 * "Received", "Old" and "Approved" are the normal case and get no colour at
 * all — colouring the good state as well would leave nothing standing out.
 */

/** Die and plate: only the states that block production are marked. */
function toneForApproval(status: string): string {
  if (status === "Rejected") return "text-overdue";
  if (status === "Pending") return "text-at-risk";
  return "";
}

export const designColumns: LegacyColumnDef<DesignRow>[] = [
  {
    accessorKey: "designCode",
    header: "Code",
    meta: { filterable: true, width: "8rem" },
    cell: ({ row }) => (
      <Link
        href={`/designs/${row.original.id}`}
        className="text-primary font-medium hover:underline tabular-nums"
      >
        {row.original.designCode}
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
    accessorKey: "jobName",
    header: "Job",
    meta: { filterable: true, width: "18rem" },
    cell: ({ row }) => (
      <span className={row.original.isActive ? "" : "text-muted-foreground"}>
        {row.original.jobName}
        {!row.original.isActive ? (
          <span className="text-muted-foreground ml-2 text-[11px]">(retired)</span>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "jobSize",
    header: "Size",
    meta: { width: "8rem" },
    cell: ({ row }) => row.original.jobSize ?? "—",
  },
  {
    accessorKey: "paperType",
    header: "Paper",
    meta: { filterable: true, width: "9rem" },
    cell: ({ row }) => {
      const { paperType, gsm } = row.original;
      if (!paperType && !gsm) return "—";
      return [paperType, gsm ? `${gsm} gsm` : null].filter(Boolean).join(" · ");
    },
  },
  {
    accessorKey: "approvalStatus",
    header: "Approval",
    meta: { width: "7rem" },
    cell: ({ row }) => (
      <span className={cn(toneForApproval(row.original.approvalStatus))}>
        {row.original.approvalStatus}
      </span>
    ),
  },
  {
    accessorKey: "processCount",
    header: "Route",
    meta: { align: "right", width: "6rem" },
    cell: ({ row }) =>
      row.original.processCount === 0 ? (
        // Not an error: an empty route means the job follows the default for
        // its type rather than a design-specific one (decision F4).
        <span className="text-muted-foreground">default</span>
      ) : (
        <span className="tabular-nums">{row.original.processCount} stages</span>
      ),
  },
];
