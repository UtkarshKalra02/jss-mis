import type { Metadata } from "next";
import Image from "next/image";

import { requireAccess } from "@/auth/guard";
import { ItemsPrintBar } from "@/components/items/print-bar";
import { formatCommittedDate, formatDaysToCommitted, formatDate, formatQty } from "@/lib/format";
import { todayIST } from "@/lib/dates";
import { filterSummary, groupByStage, type StageGroup } from "@/modules/items/grouping";
import { searchItems, type ItemSearchRow, type RiskFilter } from "@/modules/items/queries";
import { listAllStages } from "@/modules/stage-update/queries";

export const metadata: Metadata = { title: "Pending work · print" };

/**
 * THE PENDING WORK SHEET — every open item and where it has reached, on paper.
 *
 * INTERNAL. It carries every client's jobs on one page, so it is for the floor
 * and for the queue meeting and must never be handed to a customer. A
 * client-facing status sheet is a different document scoped to one client, and
 * is deliberately not this.
 *
 * IT PRINTS WHAT THE TRACKER WAS SHOWING. The same `q`, `all` and `risk`
 * parameters the Item Tracker reads are read here, so one Print link gives you
 * everything, or just the overdue ones, or just one client, without a second
 * mechanism existing to say the same thing (F22). THE SHEET STATES WHICH
 * FILTER PRODUCED IT — a printed subset that does not admit to being one is
 * worse than a filtered screen, because the paper outlives the search box and
 * nobody holding it can see what was typed.
 *
 * TWO SHAPES, chosen with `?group=`:
 *
 *   stage   — a block per stage in process order. Answers "where is
 *             everything", which is the walking-the-floor question.
 *   urgency — one flat table, overdue first. Answers "what is late", which is
 *             the 6pm meeting question.
 *
 * Both were asked for. They are the same rows arranged twice, not two reports:
 * the grouping is a pure function over what the tracker already returns.
 */

/** Generous, and honest when it bites — see the note by `truncated` below. */
const PRINT_LIMIT = 1000;

export default async function ItemsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string; risk?: string; group?: string }>;
}) {
  await requireAccess("item_tracker");

  const sp = await searchParams;
  const query = sp.q ?? "";
  const openOnly = sp.all !== "1";
  const risk: RiskFilter | undefined =
    sp.risk === "overdue" || sp.risk === "at-risk" ? sp.risk : undefined;
  const group = sp.group === "urgency" ? "urgency" : "stage";

  const [rows, stages] = await Promise.all([
    searchItems(query, { openOnly, risk, limit: PRINT_LIMIT }),
    listAllStages(),
  ]);

  /*
   * The query is capped, and a capped sheet has to say so.
   *
   * A supervisor counting pieces off this page against the floor will find the
   * numbers short and no explanation for it — which is exactly the failure the
   * "2 of 3 jobs shown" line on Stage Update exists to prevent (H8).
   */
  const truncated = rows.length === PRINT_LIMIT;

  const totalPending = rows.reduce((sum, r) => sum + r.pendingQty, 0);
  const overdue = rows.filter((r) => r.isOverdue).length;
  const groups = group === "stage" ? groupByStage(rows, stages) : [];

  return (
    <>
      <ItemsPrintBar group={group} />

      <div className="print-sheet">
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
          <div className="flex items-start gap-3">
            <Image src="/jss-logo.png" alt="" width={44} height={44} priority />
            <div>
              <h1 className="text-[15pt] leading-tight font-bold tracking-tight">
                JSS THE PRINT ZONE
              </h1>
              <p className="print-label mt-0.5">Internal — not for issue to a customer</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[13pt] font-bold tracking-[0.06em] uppercase">Pending Work</p>
            <p className="print-label mt-1">Printed</p>
            <p className="print-value font-medium tabular-nums">{formatDate(todayIST())}</p>
          </div>
        </header>

        {/* What produced this sheet, and what it adds up to. Both on the paper,
            because neither is recoverable from the paper otherwise. */}
        <section className="print-avoid-break mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-neutral-400 pb-2">
          <p className="print-hint">
            {rows.length} item{rows.length === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums">{formatQty(totalPending)}</span> pieces still owed
            {overdue > 0 ? ` · ${overdue} overdue` : ""}
          </p>
          <p className="print-hint">
            {group === "stage" ? "Grouped by stage" : "Most urgent first"} ·{" "}
            {filterSummary({ query, openOnly, risk })}
          </p>
        </section>

        {truncated ? (
          <p className="print-hint mt-2 border border-black px-2 py-1">
            Showing the first {PRINT_LIMIT} items only. There is more pending work than fits
            this sheet — narrow the filter on the tracker and print again.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="mt-6 text-center text-[11pt]">
            Nothing pending against this filter.
          </p>
        ) : group === "stage" ? (
          <div className="mt-3 space-y-4">
            {groups.map((g) => (
              <StageBlock key={g.stageCode ?? "__none"} group={g} />
            ))}
          </div>
        ) : (
          <div className="mt-3">
            <ItemTable rows={rows} showStage />
          </div>
        )}

        <p className="print-hint mt-4 border-t border-neutral-400 pt-1">
          Printed from JSS MIS. Stages and quantities are live at the time of printing —
          check the tracker before acting on an old sheet.
        </p>
      </div>
    </>
  );
}

/** One stage's worth of work, with what it holds stated in the heading. */
function StageBlock({ group }: { group: StageGroup }) {
  return (
    <section className="print-avoid-break">
      <div className="flex items-baseline justify-between border-b border-black pb-0.5">
        <h2 className="text-[11pt] font-bold tracking-[0.04em] uppercase">{group.stageName}</h2>
        <p className="print-hint tabular-nums">
          {group.rows.length} item{group.rows.length === 1 ? "" : "s"} ·{" "}
          {formatQty(group.pendingQty)} pcs
        </p>
      </div>
      <ItemTable rows={group.rows} />
    </section>
  );
}

/**
 * The rows.
 *
 * `showStage` only in the flat shape — inside a stage block the column would
 * repeat the heading on every line, which is the sort of thing that makes a
 * dense sheet unreadable rather than informative.
 *
 * NO COLOUR ANYWHERE. print.css is explicit black on white, so "overdue" is
 * carried by the words in the Due column ("12 days overdue") rather than by
 * red, which a laser printer would drop to save ink.
 */
function ItemTable({ rows, showStage }: { rows: ItemSearchRow[]; showStage?: boolean }) {
  return (
    <table className="w-full border-collapse text-[9.5pt]">
      <thead>
        <tr>
          <th className="border-b border-neutral-500 px-1 py-0.5 text-left font-bold">Item</th>
          <th className="border-b border-neutral-500 px-1 py-0.5 text-left font-bold">Name</th>
          <th className="border-b border-neutral-500 px-1 py-0.5 text-left font-bold">Client</th>
          <th className="border-b border-neutral-500 px-1 py-0.5 text-left font-bold">PO</th>
          {showStage ? (
            <th className="border-b border-neutral-500 px-1 py-0.5 text-left font-bold">Stage</th>
          ) : null}
          <th className="border-b border-neutral-500 px-1 py-0.5 text-right font-bold">Pending</th>
          <th className="border-b border-neutral-500 px-1 py-0.5 text-left font-bold">Due</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.poItemId}>
            <td className="border-b border-neutral-300 px-1 py-0.5 tabular-nums">{r.itemCode}</td>
            <td className="border-b border-neutral-300 px-1 py-0.5">{r.itemName}</td>
            <td className="border-b border-neutral-300 px-1 py-0.5">{r.clientCode}</td>
            <td className="border-b border-neutral-300 px-1 py-0.5 tabular-nums">
              {r.poInternalNo}
            </td>
            {showStage ? (
              <td className="border-b border-neutral-300 px-1 py-0.5">
                {r.currentStageName ?? "Not started"}
              </td>
            ) : null}
            <td className="border-b border-neutral-300 px-1 py-0.5 text-right tabular-nums">
              {formatQty(r.pendingQty)}
            </td>
            <td className="border-b border-neutral-300 px-1 py-0.5">
              {r.committedDate ? (
                <>
                  <span className="tabular-nums">{formatCommittedDate(r.committedDate)}</span>
                  <span className={r.isOverdue ? "font-bold" : ""}>
                    {" "}
                    · {formatDaysToCommitted(r.daysToCommitted)}
                  </span>
                </>
              ) : (
                // F8: a null commitment is a real state, not a gap to fill in.
                <span className="print-hint">no commitment recorded</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
