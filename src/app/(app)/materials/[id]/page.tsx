import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { MaterialForm } from "@/components/materials/material-form";
import { RemoveIssue } from "@/components/materials/remove-issue";
import { Button } from "@/components/ui/button";
import { formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { statusTone } from "@/modules/materials/status";
import {
  batchesForMaterial,
  getMaterial,
  getStock,
  listCategories,
  listTypes,
  movementsForMaterial,
} from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Material · JSS MIS" };

function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

/**
 * One material: what is in stock, batch by batch, and every movement on it.
 * Every figure here is the view's; the edit form below cannot type a stock.
 */
export default async function MaterialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ removed?: string }>;
}) {
  const user = await requireAccess("material");
  const canWrite = can(user.role, "material", "write");

  const { id } = await params;
  const { removed } = await searchParams;
  const [stock, record] = await Promise.all([getStock(id), getMaterial(id)]);
  if (!stock || !record) notFound();

  const [batches, movements, categories, types] = await Promise.all([
    batchesForMaterial(id),
    movementsForMaterial(id),
    listCategories(),
    listTypes(),
  ]);

  const unit = stock.unit;

  return (
    <div>
      <Link href="/materials" className="text-muted-foreground text-[13px] hover:underline">
        ← Materials
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="page-title tabular-nums">{stock.sku}</h1>
        <span className="text-[15px]">{stock.name}</span>
        <span className={cn("text-[13px]", statusTone(stock.stockStatus))}>{stock.stockStatus}</span>
        {stock.reorderNote ? (
          <span className="text-muted-foreground text-[13px]">
            {stock.reorderNote}
            {stock.reorderNoteOn ? ` since ${formatDate(stock.reorderNoteOn)}` : ""}
          </span>
        ) : null}
        {stock.dueForIssue ? <span className="text-at-risk text-[13px]">Due for issue</span> : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {stock.categoryName} · {stock.typeName}
        {stock.size ? ` · ${stock.size}` : ""}
        {stock.gsm ? ` · ${stock.gsm} GSM` : ""}
        {stock.colour ? ` · ${stock.colour}` : ""}
        {stock.finish ? ` · ${stock.finish}` : ""}
      </p>

      {removed ? (
        <p role="status" className="text-on-time mt-3 text-sm">
          {removed}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-4 sm:flex-row">
        {stock.imageUrl ? (
          <a href={stock.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
            {/* A Drive link, not an image URL — Drive does not serve these
                inline. A labelled link is honest; a broken <img> is not. */}
            <span className="bg-neutral-status-bg text-primary block rounded-md px-3 py-2 text-[12px] hover:underline">
              Photo ↗
            </span>
          </a>
        ) : null}
        <dl className="grid flex-1 grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-4">
          <Figure label={`In stock (${unit})`} value={formatQty(stock.closingStock)} />
          <Figure label="In transit" value={formatQty(stock.inTransitQty)} />
          <Figure label="Open batches" value={stock.openBatches} />
          <Figure label="Last issued" value={stock.lastIssueOn ? formatDate(stock.lastIssueOn) : "—"} />
          {/* The sheet's derived figures (P2), all from actual issues. */}
          <Figure
            label={`Daily use (${unit})`}
            value={stock.adc === null ? "—" : formatQty(stock.adc)}
          />
          <Figure
            label="Days left"
            value={stock.daysRemaining === null ? "—" : formatQty(stock.daysRemaining)}
            tone={stock.needsReorder ? "text-at-risk" : undefined}
          />
          <Figure
            label="Max / reorder level"
            value={
              stock.maxLevelCalc === null
                ? "—"
                : `${formatQty(stock.maxLevelCalc)} / ${formatQty(stock.reorderLevel)}`
            }
          />
          <Figure
            label="Order by"
            value={stock.orderByDate ? formatDate(stock.orderByDate) : "—"}
            tone={stock.needsReorder ? "text-at-risk" : undefined}
          />
          <Figure
            label="Suggested order"
            value={Number(stock.suggestedOrderQty) > 0 ? formatQty(stock.suggestedOrderQty) : "—"}
          />
          <Figure label="Method" value={stock.reorderMethod} />
          <Figure label="Lead time" value={stock.leadTimeDays === null ? "—" : `${stock.leadTimeDays} d`} />
          <Figure
            label={stock.reorderMethod === "Interval" ? "Issue interval" : "MOQ"}
            value={
              stock.reorderMethod === "Interval"
                ? stock.issueIntervalDays === null
                  ? "—"
                  : `${formatQty(stock.issueIntervalDays)} d`
                : stock.minOrderQty === null
                  ? "—"
                  : formatQty(stock.minOrderQty)
            }
          />
        </dl>
      </div>

      {canWrite ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/materials/issue?material=${id}`}>Issue from this</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/materials/adjust?material=${id}`}>Adjust a batch</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/materials/receive?material=${id}`}>Receive more</Link>
          </Button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Batches</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Oldest first — the one to issue from next. Remaining is received less issued plus
            adjustments, never typed.
          </p>
          {batches.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-[13px]">Nothing received yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
            <table className="data-grid w-full">
              <thead>
                <tr>
                  <th className="px-2">Batch</th>
                  <th className="px-2">Received</th>
                  <th className="px-2">From</th>
                  <th className="px-2">For job</th>
                  <th className="px-2 text-right">Received</th>
                  <th className="px-2 text-right">Issued</th>
                  <th className="px-2 text-right">Adj.</th>
                  <th className="px-2 text-right">Left</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const empty = Number(b.qtyRemaining) <= 0;
                  return (
                    <tr key={b.batchId} className={cn(empty && "text-muted-foreground")}>
                      <td className="px-2 tabular-nums">{b.batchNo}</td>
                      <td className="px-2">{formatDate(b.receivedDate)}</td>
                      <td className="max-w-56 truncate px-2" title={b.remarks ?? undefined}>
                        {b.vendor ?? b.remarks ?? "—"}
                      </td>
                      <td className="px-2">{b.jobRef ?? "—"}</td>
                      <td className="px-2 text-right tabular-nums">{formatQty(b.qtyReceived)}</td>
                      <td className="px-2 text-right tabular-nums">{formatQty(b.qtyIssued)}</td>
                      <td className="px-2 text-right tabular-nums">{formatQty(b.qtyAdjusted)}</td>
                      <td className={cn("px-2 text-right tabular-nums", !empty && "font-medium")}>
                        {formatQty(b.qtyRemaining)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Movements</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Newest first. The whole ledger since January is here; rows marked &ldquo;row N&rdquo;
            came from the sheet.
          </p>
          {movements.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-[13px]">No issues or adjustments yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
            <table className="data-grid w-full">
              <thead>
                <tr>
                  <th className="px-2">No.</th>
                  <th className="px-2">Date</th>
                  <th className="px-2">Batch</th>
                  <th className="px-2 text-right">Qty</th>
                  <th className="px-2">Detail</th>
                  <th className="px-2">By</th>
                  {canWrite ? <th className="px-2"></th> : null}
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-2 tabular-nums">{m.no}</td>
                    <td className="px-2">{formatDate(m.on)}</td>
                    <td className="px-2 tabular-nums">{m.batchNo}</td>
                    <td className="px-2 text-right tabular-nums">{formatQty(m.qty)}</td>
                    <td className="px-2">
                      {m.kind === "Issue" ? (m.detail ?? "Issue") : m.detail}
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
                        <span className="text-muted-foreground ml-2 text-[11px]">{m.remarks}</span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-2">{m.enteredBy ?? "—"}</td>
                    {canWrite ? (
                      <td className="px-2 text-right">
                        {m.kind === "Issue" ? <RemoveIssue issueId={m.id} materialId={id} /> : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>
      </div>

      {canWrite ? (
        <div className="mt-8 max-w-3xl">
          <MaterialForm material={record} categories={categories} types={types} />
        </div>
      ) : null}
    </div>
  );
}
