import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import {
  PurchaseOrderLink,
  RemoveEnquiry,
  StatusControl,
} from "@/components/enquiries/enquiry-controls";
import { Button } from "@/components/ui/button";
import { formatCommittedDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getEnquiry, linkablePurchaseOrders } from "@/modules/enquiries/queries";

export const metadata: Metadata = { title: "Enquiry · JSS MIS" };

const STATUS_TONE: Record<string, string> = {
  Won: "text-on-time",
  Lost: "text-overdue",
  Dropped: "text-muted-foreground",
};

/**
 * One enquiry.
 *
 * DELIBERATELY NO TIMELINE. An enquiry has no stage events — it is not a job
 * yet, and nothing about it passes through the factory. Borrowing the Item
 * Tracker's timeline component here would render an empty rail that implies a
 * history the row does not have.
 */
export default async function EnquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("enquiry");
  const canWrite = can(user.role, "enquiry", "write");

  const { id } = await params;
  const enquiry = await getEnquiry(id);
  if (!enquiry) notFound();

  // Only fetched when it could be acted on — a read-only viewer gets no picker.
  const linkable =
    canWrite && !enquiry.purchaseOrderId
      ? await linkablePurchaseOrders(enquiry.clientId)
      : [];

  const chasing = enquiry.status === "Open" || enquiry.status === "Quoted";

  return (
    <div>
      <Link href="/enquiries" className="text-muted-foreground text-[13px] hover:underline">
        ← Enquiries
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="page-title tabular-nums">{enquiry.enquiryNo}</h1>
          <span className={cn("text-sm font-medium", STATUS_TONE[enquiry.status] ?? "")}>
            {enquiry.status}
          </span>
        </div>
        {canWrite ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/enquiries/${enquiry.id}/edit`}>Edit</Link>
          </Button>
        ) : null}
      </div>

      <section className="mt-6 rounded-lg border">
        <dl className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Client">
            <span title={enquiry.clientName}>
              {enquiry.clientCode} · {enquiry.clientName}
            </span>
          </Field>

          <Field label="Enquiry date">
            <span className="tabular-nums">{formatCommittedDate(enquiry.enquiryDate)}</span>
            <span
              className={cn(
                "ml-2 text-[12px]",
                chasing && enquiry.ageDays >= 7 ? "text-at-risk" : "text-muted-foreground",
              )}
            >
              {enquiry.ageDays} day{enquiry.ageDays === 1 ? "" : "s"} ago
            </span>
          </Field>

          <Field label="Source">
            {enquiry.sourceName}
            {enquiry.referredBy ? (
              <span className="text-muted-foreground"> · {enquiry.referredBy}</span>
            ) : null}
          </Field>

          <Field label="Quantity">
            {/* An em dash is "they did not say", not zero. */}
            {enquiry.qty === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="tabular-nums">{formatQty(enquiry.qty)}</span>
            )}
          </Field>

          <Field label="Client wants it by">
            {enquiry.clientRequiredDate ? (
              <>
                <span className="tabular-nums">
                  {formatCommittedDate(enquiry.clientRequiredDate)}
                </span>
                {/* K4 — said where somebody might otherwise assume it is a promise. */}
                <span className="text-muted-foreground mt-0.5 block text-[12px]">
                  Their ask, not our commitment.
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>

          <Field label="Owner">{enquiry.ownerName}</Field>

          {enquiry.closedAt ? (
            <Field label="Closed">
              <span className="tabular-nums">{formatCommittedDate(enquiry.closedAt)}</span>
            </Field>
          ) : null}
        </dl>

        <div className="border-t p-4">
          <dt className="text-muted-foreground text-xs">What they asked for</dt>
          <dd className="mt-1 text-[14px] whitespace-pre-wrap">{enquiry.itemDescription}</dd>
        </div>

        {enquiry.status === "Lost" ? (
          <div className="border-overdue/30 border-t p-4">
            <dt className="text-muted-foreground text-xs">Lost because</dt>
            <dd className="text-overdue mt-1 text-[14px]">{enquiry.lostReason}</dd>
            {enquiry.lostNotes ? (
              <p className="text-muted-foreground mt-2 text-[13px] whitespace-pre-wrap">
                {enquiry.lostNotes}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {canWrite ? (
        <section className="mt-8 space-y-6">
          <div>
            <h2 className="text-sm font-medium">Where has it got to?</h2>
            <div className="mt-3">
              <StatusControl enquiry={enquiry} />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium">Purchase order</h2>
            <div className="mt-3">
              <PurchaseOrderLink enquiry={enquiry} options={linkable} />
            </div>
          </div>

          <div className="border-t pt-6">
            <RemoveEnquiry enquiry={enquiry} />
          </div>
        </section>
      ) : enquiry.purchaseOrderId ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Purchase order</h2>
          <p className="mt-2 text-[13px]">
            Linked to{" "}
            <Link
              href={`/purchase-orders/${enquiry.purchaseOrderId}`}
              className="text-primary tabular-nums hover:underline"
            >
              {enquiry.poInternalNo}
            </Link>
            .
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 text-[14px]">{children}</dd>
    </div>
  );
}
