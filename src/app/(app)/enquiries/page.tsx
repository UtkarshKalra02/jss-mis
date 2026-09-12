import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { EnquiryFilters } from "@/components/enquiries/enquiry-filters";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { enquiryColumns } from "@/modules/enquiries/columns";
import {
  listEnquiries,
  listOwnerOptions,
  listSourceOptions,
  type EnquiryFilters as Filters,
} from "@/modules/enquiries/queries";
import { enquiryStatuses, type EnquiryStatus } from "@/modules/enquiries/validation";

export const metadata: Metadata = { title: "Enquiries · JSS MIS" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The enquiry register (spec 4.2, built ahead of the quotation screens).
 *
 * DEFAULTS TO OPEN, which is the one thing about this screen worth arguing
 * with. Punit's question on any given morning is "what am I still owed an
 * answer on", and burying six live enquiries under two years of Won and Lost
 * ones is the failure the Item Tracker's open-only default exists to prevent
 * (F22). The filter says so on screen and offers the way out, because a grid
 * quietly showing a subset is the thing a register must never be.
 */
export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    source?: string;
    owner?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await requireAccess("enquiry");
  // "New enquiry" is offered on "create", which OWNER holds (K20). Nothing on
  // this list edits a row, so nothing here needs "write".
  const canCreate = can(user.role, "enquiry", "create");

  const sp = await searchParams;

  /*
   * Anything unrecognised is treated as the default rather than as an empty
   * result. A mistyped URL should show the register, not an empty screen that
   * looks like there are no enquiries.
   */
  const statusParam = sp.status ?? "Open";
  const status: EnquiryStatus | undefined = (enquiryStatuses as readonly string[]).includes(
    statusParam,
  )
    ? (statusParam as EnquiryStatus)
    : undefined;

  const filters: Filters = {
    status,
    sourceId: sp.source || undefined,
    ownerUserId: sp.owner || undefined,
    from: sp.from && ISO_DATE.test(sp.from) ? sp.from : undefined,
    to: sp.to && ISO_DATE.test(sp.to) ? sp.to : undefined,
  };

  const [sources, owners] = await Promise.all([listSourceOptions(), listOwnerOptions()]);

  const key = [statusParam, sp.source, sp.owner, sp.from, sp.to].join(":");

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Enquiries</h1>
        {canCreate ? (
          <Button asChild size="sm">
            <Link href="/enquiries/new">New enquiry</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Everything that was asked for, and what came of it. Showing open enquiries by
        default — change the status filter to see the rest.
      </p>

      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-9 w-full max-w-2xl" />}>
          <EnquiryFilters
            sources={sources}
            owners={owners}
            status={statusParam}
            sourceId={sp.source ?? ""}
            ownerUserId={sp.owner ?? ""}
            from={sp.from ?? ""}
            to={sp.to ?? ""}
          />
        </Suspense>
      </div>

      <div className="mt-6">
        <Suspense key={key} fallback={<Skeleton className="h-96 w-full" />}>
          <Results filters={filters} canCreate={canCreate} filtered={key !== "Open::::"} />
        </Suspense>
      </div>
    </div>
  );
}

/** Split out so the filters stay interactive while this re-runs (section 7). */
async function Results({
  filters,
  canCreate,
  filtered,
}: {
  filters: Filters;
  canCreate: boolean;
  filtered: boolean;
}) {
  const rows = await listEnquiries(filters);

  return (
    <DataTable
      columns={enquiryColumns}
      data={rows}
      emptyMessage={
        filtered
          ? "Nothing matches those filters."
          : canCreate
            ? "No open enquiries. Record the next one that comes in — that is what makes the win rate mean something."
            : "No open enquiries."
      }
    />
  );
}
