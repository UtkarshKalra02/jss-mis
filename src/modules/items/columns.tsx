"use client";

import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import Link from "next/link";

import { StagePill } from "@/components/stages/stage-pill";
import { formatCommittedDate, formatDaysToCommitted, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ItemSearchRow } from "./queries";

/**
 * The tracker grid.
 *
 * Section 7's semantic colours, and only where they mean something: red for
 * overdue, amber for at risk. Everything else is neutral, so the two rows that
 * need attention on a screen of forty are the ones that stand out.
 */
export const itemColumns: LegacyColumnDef<ItemSearchRow>[] = [
  {
    accessorKey: "itemCode",
    header: "Item",
    meta: { filterable: true, width: "9.5rem" },
    cell: ({ row }) => (
      <Link
        href={`/items/${row.original.poItemId}`}
        className="text-primary font-medium tabular-nums hover:underline"
      >
        {row.original.itemCode}
      </Link>
    ),
  },
  {
    accessorKey: "itemName",
    header: "Name",
    meta: { filterable: true, width: "16rem" },
    cell: ({ row }) => (
      <span
        className={cn(row.original.status === "Cancelled" && "text-muted-foreground line-through")}
      >
        {row.original.itemName}
      </span>
    ),
  },
  {
    accessorKey: "clientCode",
    header: "Client",
    meta: { filterable: true, width: "6.5rem" },
    cell: ({ row }) => <span title={row.original.clientName}>{row.original.clientCode}</span>,
  },
  {
    accessorKey: "poInternalNo",
    header: "PO",
    meta: { filterable: true, width: "9rem" },
    cell: ({ row }) => (
      <span className="tabular-nums" title={row.original.clientPoNo ?? undefined}>
        {row.original.poInternalNo}
      </span>
    ),
  },
  {
    accessorKey: "orderedQty",
    header: "Ordered",
    meta: { align: "right", width: "6.5rem" },
    cell: ({ row }) => <span className="tabular-nums">{formatQty(row.original.orderedQty)}</span>,
  },
  {
    accessorKey: "pendingQty",
    header: "Pending",
    meta: { align: "right", width: "6.5rem" },
    cell: ({ row }) => (
      <span
        className={cn("tabular-nums", row.original.pendingQty === 0 && "text-muted-foreground")}
      >
        {formatQty(row.original.pendingQty)}
      </span>
    ),
  },
  {
    accessorKey: "currentStage",
    header: "Stage",
    meta: { filterable: true, width: "10rem" },
    cell: ({ row }) => (
      <StagePill
        name={row.original.currentStageName}
        colour={row.original.currentStageColour}
      />
    ),
  },
  {
    accessorKey: "committedDate",
    header: "Committed",
    meta: { width: "11rem" },
    cell: ({ row }) => {
      const { committedDate, isOverdue, isAtRisk, daysToCommitted, status } = row.original;

      // F8: a historical row says so rather than showing an empty cell.
      if (!committedDate) {
        return <span className="text-muted-foreground text-[11px]">Historical — none</span>;
      }

      return (
        <span className={cn(isOverdue && "text-overdue", isAtRisk && "text-at-risk")}>
          {formatCommittedDate(committedDate)}
          {status === "Open" ? (
            <span className="ml-2 text-[11px] opacity-80">
              {formatDaysToCommitted(daysToCommitted)}
            </span>
          ) : null}
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { filterable: true, width: "6.5rem" },
    cell: ({ row }) => (
      <span
        className={cn(
          row.original.status === "Cancelled" && "text-muted-foreground",
          row.original.status === "Closed" && "text-on-time",
        )}
      >
        {row.original.status}
      </span>
    ),
  },
];
