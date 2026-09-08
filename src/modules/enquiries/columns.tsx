"use client";

import type { LegacyColumnDef } from "@tanstack/react-table/legacy";
import Link from "next/link";

import { formatCommittedDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { EnquiryRow } from "./queries";

/**
 * How each status reads.
 *
 * Semantic colour only where it means something (section 7). Lost is the one
 * that gets red — it is the outcome the register exists to reduce. Won is
 * green, Dropped and everything else stay neutral: a dropped enquiry is not a
 * failure, and colouring it as one would put a red row on the screen for a
 * client who simply shelved a product.
 */
const STATUS_TONE: Record<string, string> = {
  Won: "text-on-time",
  Lost: "text-overdue",
  Dropped: "text-muted-foreground",
};

/**
 * Age matters differently depending on where the enquiry is.
 *
 * Only OPEN and QUOTED enquiries age — those are the ones somebody still owes
 * an answer on. A closed one's age is a historical fact, not a prompt, and
 * amber on a three-month-old Won enquiry would be noise on every row of the
 * register within a quarter.
 *
 * The thresholds are deliberately soft and are NOT the dashboard's at-risk
 * window: that one is configured in app_setting and measures a commitment
 * being missed. Nothing here has been measured on the floor, so nothing here
 * claims a target — it is a nudge, and it is only ever amber.
 */
function ageTone(row: EnquiryRow): string {
  const chasing = row.status === "Open" || row.status === "Quoted";
  return chasing && row.ageDays >= 7 ? "text-at-risk" : "";
}

export const enquiryColumns: LegacyColumnDef<EnquiryRow>[] = [
  {
    accessorKey: "enquiryNo",
    header: "Enquiry",
    meta: { filterable: true, width: "9.5rem" },
    cell: ({ row }) => (
      <Link
        href={`/enquiries/${row.original.id}`}
        className="text-primary font-medium tabular-nums hover:underline"
      >
        {row.original.enquiryNo}
      </Link>
    ),
  },
  {
    accessorKey: "enquiryDate",
    header: "Date",
    meta: { width: "7rem" },
    cell: ({ row }) => (
      <span className="tabular-nums">{formatCommittedDate(row.original.enquiryDate)}</span>
    ),
  },
  {
    accessorKey: "clientCode",
    header: "Client",
    meta: { filterable: true, width: "7rem" },
    cell: ({ row }) => <span title={row.original.clientName}>{row.original.clientCode}</span>,
  },
  {
    accessorKey: "itemDescription",
    header: "Item",
    meta: { filterable: true, width: "20rem" },
    cell: ({ row }) => (
      <span className="line-clamp-2" title={row.original.itemDescription}>
        {row.original.itemDescription}
      </span>
    ),
  },
  {
    accessorKey: "qty",
    header: "Qty",
    meta: { width: "6rem", align: "right" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {/* An em dash is "they did not say", which is a different statement
            from zero and a normal thing for an enquiry to be missing. */}
        {row.original.qty === null ? "—" : formatQty(row.original.qty)}
      </span>
    ),
  },
  {
    accessorKey: "sourceName",
    header: "Source",
    meta: { filterable: true, width: "8.5rem" },
    cell: ({ row }) => (
      <span className="text-muted-foreground" title={row.original.referredBy ?? undefined}>
        {row.original.sourceName}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { filterable: true, width: "7rem" },
    cell: ({ row }) => (
      <span className={cn("font-medium", STATUS_TONE[row.original.status] ?? "")}>
        {row.original.status}
      </span>
    ),
  },
  {
    accessorKey: "ownerName",
    header: "Owner",
    meta: { filterable: true, width: "9rem" },
  },
  {
    accessorKey: "ageDays",
    header: "Age",
    meta: { width: "5.5rem", align: "right" },
    cell: ({ row }) => (
      <span className={cn("tabular-nums", ageTone(row.original))}>
        {row.original.ageDays}d
      </span>
    ),
  },
];
