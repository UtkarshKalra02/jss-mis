import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { StageTimeline } from "@/components/items/stage-timeline";
import { StagePill } from "@/components/stages/stage-pill";
import {
  formatCommittedDate,
  formatDate,
  formatDaysToCommitted,
  formatINR,
  formatQty,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getItemDetail,
  getItemDispatches,
  getItemJobCards,
  getItemStatus,
  getItemTimeline,
} from "@/modules/items/queries";
import { AddToRunControl } from "@/components/press-runs/run-controls";
import { gangInfoFor, recentRuns } from "@/modules/press-runs/queries";

export const metadata: Metadata = { title: "Item · JSS MIS" };

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Spec 6.4's detail view: ordered / dispatched / pending, the current stage,
 * the committed date and days remaining, the full stage timeline, and the
 * linked job cards, dispatches and invoices.
 *
 * Invoices are Phase 5 and are deliberately not stubbed here — an empty panel
 * labelled "Invoices" on a screen that cannot have any is a question rather
 * than an answer.
 */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("item_tracker");

  const { id } = await params;
  const item = await getItemStatus(id);
  if (!item) notFound();

  const [detail, timeline, dispatches, jobCards] = await Promise.all([
    getItemDetail(id),
    getItemTimeline(id),
    getItemDispatches(id),
    getItemJobCards(id),
  ]);

  const canSeePo = can(user.role, "purchase_order");
  const canGang = can(user.role, "press_run", "write");

  /**
   * Ganging (H4). Two extra reads, and both are skipped entirely when this item
   * has no job cards — which is every item today and most items forever, since
   * ganging is three to eight jobs a month.
   */
  const gangs = await gangInfoFor(jobCards.map((jc) => jc.id));
  const runs =
    canGang && jobCards.some((jc) => jc.pressRunId === null) ? await recentRuns() : [];

  return (
    <div>
      <Link href="/items" className="text-muted-foreground text-[13px] hover:underline">
        ← Item tracker
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="page-title tabular-nums">{item.itemCode}</h1>
        <span className="text-[15px]">{item.itemName}</span>
        <StagePill name={item.currentStageName} colour={item.currentStageColour} />
        {item.status !== "Open" ? (
          <span
            className={cn(
              "text-[13px]",
              item.status === "Cancelled" && "text-muted-foreground",
              item.status === "Closed" && "text-on-time",
            )}
          >
            {item.status}
          </span>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-1 text-[13px]">
        {item.clientCode} — {item.clientName} ·{" "}
        {canSeePo ? (
          <Link href={`/purchase-orders/${item.purchaseOrderId}`} className="hover:underline">
            {item.poInternalNo}
          </Link>
        ) : (
          item.poInternalNo
        )}
        {item.clientPoNo ? ` · their PO ${item.clientPoNo}` : ""} · dated{" "}
        {formatDate(item.poDate)}
      </p>

      <dl className="mt-6 grid gap-4 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Figure label="Ordered" value={formatQty(item.orderedQty)} />
        <Figure label="Dispatched" value={formatQty(item.dispatchedQty)} />
        <Figure
          label="Pending"
          value={formatQty(item.pendingQty)}
          tone={item.pendingQty === 0 ? "text-muted-foreground" : undefined}
        />
        <Figure
          label="Committed"
          value={
            // F8: a historical row says so rather than showing a blank.
            item.committedDate ? (
              formatCommittedDate(item.committedDate)
            ) : (
              <span className="text-muted-foreground text-[13px]">
                Historical — no commitment recorded
              </span>
            )
          }
          tone={cn(item.isOverdue && "text-overdue", item.isAtRisk && "text-at-risk")}
        />
        <Figure
          label="Due in"
          value={
            item.committedDate && item.status === "Open" ? (
              formatDaysToCommitted(item.daysToCommitted)
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
          tone={cn(item.isOverdue && "text-overdue", item.isAtRisk && "text-at-risk")}
        />
      </dl>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Panel title="Stage timeline">
            <StageTimeline entries={timeline} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Order">
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <Figure label="Rate" value={formatINR(detail?.rate)} />
              <Figure label="Job type" value={item.jobType} />
              <Figure label="Priority" value={item.priority} />
              <Figure label="Committed date basis" value={detail?.committedDateBasis ?? "—"} />
            </dl>
            {detail?.remarks ? (
              <p className="text-muted-foreground mt-3 text-[13px]">{detail.remarks}</p>
            ) : null}
          </Panel>

          <Panel title="Design">
            {detail?.designCode ? (
              <div className="space-y-2 text-[13px]">
                <p>
                  {can(user.role, "design") ? (
                    <Link
                      href={`/designs/${detail.designId}`}
                      className="text-primary tabular-nums hover:underline"
                    >
                      {detail.designCode}
                    </Link>
                  ) : (
                    <span className="tabular-nums">{detail.designCode}</span>
                  )}{" "}
                  — {detail.designJobName}
                </p>
                <p className="text-muted-foreground">
                  Approval {detail.designApprovalStatus} · die {detail.designDieStatus} · plate{" "}
                  {detail.designPlateStatus}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-[13px]">
                No design linked. Not every item needs one.
              </p>
            )}
          </Panel>

          <Panel title="Dispatches">
            {dispatches.length === 0 ? (
              <p className="text-muted-foreground text-[13px]">Nothing dispatched yet.</p>
            ) : (
              <table className="data-grid w-full">
                <thead>
                  <tr>
                    <th className="px-2">Challan</th>
                    <th className="px-2">Date</th>
                    <th className="px-2 text-right">Qty</th>
                    <th className="px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatches.map((d) => (
                    <tr key={d.id}>
                      <td className="px-2 tabular-nums">{d.challanNo}</td>
                      <td className="px-2">{formatDate(d.dispatchDate)}</td>
                      <td className="px-2 text-right tabular-nums">{formatQty(d.qty)}</td>
                      <td
                        className={cn(
                          "px-2",
                          // A cancelled challan consumes no order quantity, so
                          // it has to be visibly not counted.
                          d.status === "Cancelled" && "text-muted-foreground line-through",
                        )}
                      >
                        {d.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {jobCards.length > 0 ? (
            <Panel title="Job cards">
              <table className="data-grid w-full">
                <thead>
                  <tr>
                    <th className="px-2">Card</th>
                    <th className="px-2">Planned</th>
                    <th className="px-2 text-right">Qty</th>
                    <th className="px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jobCards.map((jc) => {
                    const gang = gangs.get(jc.id);

                    return (
                      <tr key={jc.id}>
                        <td className="px-2 tabular-nums">{jc.jcNo}</td>
                        <td className="px-2">{formatDate(jc.plannedDate)}</td>
                        <td className="px-2 text-right tabular-nums">
                          {formatQty(jc.plannedQty)}
                        </td>
                        <td className="px-2">
                          {jc.status}
                          {/* The ganged badge (H4). Says how many OTHERS share
                              the plate, because that is the sentence somebody
                              reads — "3 job cards in this run" makes them do
                              the subtraction. A run of one is real and
                              transient, so it links without claiming a gang. */}
                          {gang ? (
                            <Link
                              href={`/press-runs/${gang.pressRunId}`}
                              className="bg-neutral-status-bg text-primary ml-2 rounded-full px-2 py-0.5 text-[11px] hover:underline"
                            >
                              {gang.others > 0
                                ? `Ganged with ${gang.others} other${gang.others === 1 ? "" : "s"}`
                                : `On run ${gang.runNo}`}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* ADMIN and PLANNER only. There is no job card SCREEN yet —
                  job cards arrive in Phase 4 — so the action lives where a job
                  card is actually visible today. The Phase 4 planning board
                  calls the same server action (H6). */}
              {canGang
                ? jobCards
                    .filter((jc) => jc.pressRunId === null)
                    .map((jc) => (
                      <AddToRunControl
                        key={jc.id}
                        jobCardId={jc.id}
                        jcNo={jc.jcNo}
                        runs={runs}
                      />
                    ))
                : null}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
