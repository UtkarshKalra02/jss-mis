import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { LogFilters } from "@/components/materials/log-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { LOG_LIMIT, listMovementLog } from "@/modules/materials/queries";
import { MOVEMENT_KINDS, type MovementKind } from "@/modules/materials/validation";

export const metadata: Metadata = { title: "In/Out log · JSS MIS" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 30;

/** Today, minus n days, as yyyy-mm-dd in the factory's own day (IST). */
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Every movement in the store, newest entry first — what the store has been
 * typing, not what stock is (P4). ADMIN only: the store's own people see the
 * stock list and each material's history; this is the page for checking on
 * them, so it is gated on `admin`, not on `material`.
 */
export default async function MovementLogPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; from?: string; to?: string; q?: string }>;
}) {
  await requireAccess("admin", "write");

  const sp = await searchParams;
  const kind = (MOVEMENT_KINDS as readonly string[]).includes(sp.kind ?? "")
    ? (sp.kind as MovementKind)
    : undefined;
  const from = sp.from && ISO_DATE.test(sp.from) ? sp.from : undefined;
  const to = sp.to && ISO_DATE.test(sp.to) ? sp.to : undefined;

  // No dates at all means the last thirty days, not all time — the ledger
  // runs from January and a page of everything is not a page.
  const defaulted = !from && !to;
  const { rows, truncated } = await listMovementLog({
    kind,
    from: defaulted ? daysAgo(DEFAULT_DAYS) : from,
    to,
    query: sp.q,
  });

  return (
    <div>
      <Link href="/materials" className="text-muted-foreground text-[13px] hover:underline">
        ← Materials
      </Link>
      <h1 className="page-title mt-2">In/Out log</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Every receipt, issue and adjustment across the store, in the order they were entered.
        &ldquo;Entered&rdquo; is when the row was typed; &ldquo;Dated&rdquo; is the date it was
        given.
        {defaulted ? ` Showing the last ${DEFAULT_DAYS} days — set a date to see further back.` : ""}
      </p>

      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-9 w-full max-w-2xl" />}>
          <LogFilters kind={sp.kind ?? ""} from={sp.from ?? ""} to={sp.to ?? ""} query={sp.q ?? ""} />
        </Suspense>
      </div>

      {truncated ? (
        <p role="status" className="text-at-risk mt-4 text-[13px]">
          More than {LOG_LIMIT} movements match; only the newest {LOG_LIMIT} are shown. Narrow
          the dates.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-[13px]">
          Nothing entered {defaulted ? `in the last ${DEFAULT_DAYS} days` : "in this range"}.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="data-grid w-full">
            <thead>
              <tr>
                <th className="px-2">Entered</th>
                <th className="px-2">By</th>
                <th className="px-2">Movement</th>
                <th className="px-2">No.</th>
                <th className="px-2">Dated</th>
                <th className="px-2">Material</th>
                <th className="px-2 text-right">Qty</th>
                <th className="hidden px-2 md:table-cell">Batch</th>
                <th className="px-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={`${m.kind}:${m.id}`}>
                  <td className="px-2 whitespace-nowrap tabular-nums">{formatDateTime(m.enteredAt)}</td>
                  <td className="px-2 whitespace-nowrap">{m.enteredBy ?? "—"}</td>
                  <td className="px-2">{m.kind}</td>
                  <td className="px-2 whitespace-nowrap tabular-nums">{m.no}</td>
                  <td className="px-2 whitespace-nowrap">{formatDate(m.on)}</td>
                  <td className="px-2">
                    <Link
                      href={`/materials/${m.materialId}`}
                      className="text-primary whitespace-nowrap tabular-nums hover:underline"
                    >
                      {m.sku}
                    </Link>
                    <span className="text-muted-foreground block max-w-48 truncate text-[12px]" title={m.name}>
                      {m.name}
                    </span>
                  </td>
                  <td className="px-2 text-right whitespace-nowrap tabular-nums">
                    {formatQty(m.qty)} {m.unit}
                  </td>
                  <td className="hidden px-2 whitespace-nowrap tabular-nums md:table-cell">{m.batchNo}</td>
                  <td className="max-w-md px-2">
                    {m.detail ?? "—"}
                    {m.jcNo ? (
                      <Link
                        href={`/job-cards/${m.jobCardId}`}
                        className="text-primary ml-2 tabular-nums hover:underline"
                      >
                        {m.jcNo}
                      </Link>
                    ) : m.jobRef ? (
                      <span className="ml-2">· {m.jobRef}</span>
                    ) : null}
                    {m.remarks ? (
                      <span className="text-muted-foreground block truncate text-[11px]" title={m.remarks}>
                        {m.remarks}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
