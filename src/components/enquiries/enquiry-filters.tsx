"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/utils";
import type { OwnerOption, SourceOption } from "@/modules/enquiries/queries";
import { enquiryStatuses } from "@/modules/enquiries/validation";

const selectClass =
  "border-input bg-background h-9 rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * The register's filters, all of them living in the URL.
 *
 * Same reasoning as the Item Tracker's (F22): a filtered view is a link, the
 * back button does what it looks like it does, and the dashboard tile can
 * point at `?status=Open` without a second mechanism existing to express it.
 *
 * The status filter defaults to Open, which is why "All" is a real option here
 * rather than the absence of one — a screen that silently shows a subset needs
 * to say so and offer the way out.
 */
export function EnquiryFilters({
  sources,
  owners,
  status,
  sourceId,
  ownerUserId,
  from,
  to,
}: {
  sources: SourceOption[];
  owners: OwnerOption[];
  status: string;
  sourceId: string;
  ownerUserId: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next}`));
  };

  const anyFilter = Boolean(sourceId || ownerUserId || from || to) || status !== "Open";

  return (
    <div className={cn("flex flex-wrap items-end gap-3", isPending && "opacity-70")}>
      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">Status</span>
        <select
          value={status}
          onChange={(e) => set("status", e.target.value === "All" ? "All" : e.target.value)}
          className={selectClass}
          aria-label="Filter by status"
        >
          <option value="All">All</option>
          {enquiryStatuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">Source</span>
        <select
          value={sourceId}
          onChange={(e) => set("source", e.target.value)}
          className={selectClass}
          aria-label="Filter by source"
        >
          <option value="">Any</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">Owner</span>
        <select
          value={ownerUserId}
          onChange={(e) => set("owner", e.target.value)}
          className={selectClass}
          aria-label="Filter by owner"
        >
          <option value="">Anyone</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => set("from", e.target.value)}
          className={selectClass}
          aria-label="Enquiries on or after"
        />
      </label>

      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => set("to", e.target.value)}
          className={selectClass}
          aria-label="Enquiries on or before"
        />
      </label>

      {anyFilter ? (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace(pathname))}
          className="text-primary h-9 text-[13px] hover:underline"
        >
          Reset to open
        </button>
      ) : null}
    </div>
  );
}
