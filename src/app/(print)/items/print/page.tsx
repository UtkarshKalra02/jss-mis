import type { Metadata } from "next";
import Image from "next/image";

import { requireAccess } from "@/auth/guard";
import { ReportFilters } from "@/components/items/report-filters";
import { formatCommittedDate, formatDaysToCommitted, formatDate, formatQty } from "@/lib/format";
import { todayIST } from "@/lib/dates";
import { listClientOptions } from "@/modules/designs/queries";
import { filterSummary, groupItems, type ItemGroup } from "@/modules/items/grouping";
import { searchItems, type ItemSearchRow } from "@/modules/items/queries";
import {
  GROUP_LABELS,
  NO_STAGE,
  SORT_LABELS,
  type GroupBy,
  type ItemSortKey,
} from "@/modules/items/report-options";
import { listAllStages } from "@/modules/stage-update/queries";

export const metadata: Metadata = { title: "Pending work · print" };

/**
 * THE PENDING WORK SHEET — every open item and where it has reached (K16),
 * built to order (K17).
 *
 * INTERNAL. It carries several clients' jobs on one page, so it is for the
 * floor and the queue meeting and must never be handed to a customer. A
 * client-facing status sheet is a different document scoped to one client, and
 * is deliberately not this.
 *
 * ALWAYS PENDING WORK. Open items with quantity still owed, and no filter can
 * widen that — a sheet headed "Pending Work" that could be made to contain
 * delivered jobs would be a sheet whose title depends on what somebody ticked.
 * The report narrows; it never broadens.
 *
 * THE FILTERS LIVE IN THE URL and the QUERY DOES THE WORK. Clients, stages and
 * the ordered-between range are all predicates in SQL, so the row cap takes the
 * right rows and the count in the header cannot disagree with the rows beneath
 * it. Grouping is a pure function over what comes back, which is why the three
 * shapes cannot drift apart — they are one dataset arranged three ways.
 *
 * TWO DIFFERENT DATES, on purpose. The range filters on PO DATE — when the
 * order came in — while "month due" groups by COMMITTED DATE. "Orders taken in
 * August, grouped by when they are due" is the capacity question worth asking,
 * and both are labelled on the sheet so neither can be read as the other.
 */

/** Generous, and honest when it bites — see the note by `truncated`. */
const PRINT_LIMIT = 1000;

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: string | undefined) => (v && ISO_DATE.test(v) ? v : undefined);

export default async function ItemsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    clients?: string;
    stages?: string;
    from?: string;
    to?: string;
    group?: string;
    sort?: string;
  }>;
}) {
  await requireAccess("item_tracker");

  const sp = await searchParams;
  const query = sp.q ?? "";
  const clientIds = csv(sp.clients);
  const stageCodes = csv(sp.stages);
  const poDateFrom = date(sp.from);
  const poDateTo = date(sp.to);

  // Anything unrecognised falls back to the default rather than to an empty
  // sheet — a mistyped URL should print the report, not nothing.
  const groupBy: GroupBy =
    sp.group === "client" || sp.group === "month" ? sp.group : "stage";
  const sort: ItemSortKey =
    sp.sort === "itemCode" ||
    sp.sort === "client" ||
    sp.sort === "pendingQty" ||
    sp.sort === "stage"
      ? sp.sort
      : "urgency";

  const [rows, stages, clients] = await Promise.all([
    searchItems(query, {
      openOnly: true,
      limit: PRINT_LIMIT,
      clientIds,
      stageCodes,
      poDateFrom,
      poDateTo,
      sort,
    }),
    listAllStages(),
    listClientOptions(),
  ]);

  /*
   * The query is capped, and a capped sheet has to say so.
   *
   * A supervisor counting pieces off this page against the floor would find
   * the numbers short with no explanation — exactly the failure the "2 of 3
   * jobs shown" line prevents on Stage Update (H8).
   */
  const truncated = rows.length === PRINT_LIMIT;

  const totalPending = rows.reduce((sum, r) => sum + r.pendingQty, 0);
  const overdue = rows.filter((r) => r.isOverdue).length;
  const groups = groupItems(rows, groupBy, stages);

  // Names rather than ids, because the sheet is read by somebody who has never
  // seen a uuid and cannot look one up from paper.
  const clientNames = clientIds
    .map((id) => clients.find((c) => c.id === id)?.code)
    .filter((c): c is string => Boolean(c));

  const stageNames = stageCodes
    .map((code) =>
      code === NO_STAGE ? "Not started" : stages.find((s) => s.code === code)?.name,
    )
    .filter((s): s is string => Boolean(s));

  return (
    <>
      <ReportFilters
        clients={clients}
        stages={stages}
        selectedClients={clientIds}
        selectedStages={stageCodes}
        query={query}
        poDateFrom={poDateFrom ?? ""}
        poDateTo={poDateTo ?? ""}
        groupBy={groupBy}
        sort={sort}
      />

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
        <section className="print-avoid-break mt-2 border-b border-neutral-400 pb-2">
          <p className="print-hint">
            {rows.length} item{rows.length === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums">{formatQty(totalPending)}</span> pieces still owed
            {overdue > 0 ? ` · ${overdue} overdue` : ""} · {GROUP_LABELS[groupBy]},{" "}
            {SORT_LABELS[sort]}
          </p>
          <p className="print-hint mt-0.5">
            {filterSummary({ query, clientNames, stageNames, poDateFrom, poDateTo })}
          </p>
        </section>

        {truncated ? (
          <p className="print-hint mt-2 border border-black px-2 py-1">
            Showing the first {PRINT_LIMIT} items only. There is more pending work than fits
            this sheet — narrow the filters and print again.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="mt-6 text-center text-[11pt]">Nothing pending against these filters.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {groups.map((g) => (
              <Block key={g.key ?? "__none"} group={g} showStage={groupBy !== "stage"} />
            ))}
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

/** One block, with what it holds stated in the heading. */
function Block({ group, showStage }: { group: ItemGroup; showStage: boolean }) {
  return (
    <section className="print-avoid-break">
      <div className="flex items-baseline justify-between border-b border-black pb-0.5">
        <h2 className="text-[11pt] font-bold tracking-[0.04em] uppercase">{group.label}</h2>
        <p className="print-hint tabular-nums">
          {group.rows.length} item{group.rows.length === 1 ? "" : "s"} ·{" "}
          {formatQty(group.pendingQty)} pcs
        </p>
      </div>
      <ItemTable rows={group.rows} showStage={showStage} />
    </section>
  );
}

/**
 * The rows.
 *
 * `showStage` is off when the blocks ARE the stages — the column would repeat
 * the heading on every line, which is what makes a dense sheet unreadable
 * rather than informative.
 *
 * NO COLOUR ANYWHERE. print.css is explicit black on white, so "overdue" is
 * carried by the words in the Due column ("12 days overdue", set bold) rather
 * than by red, which a laser printer would drop to save ink.
 */
function ItemTable({ rows, showStage }: { rows: ItemSearchRow[]; showStage: boolean }) {
  return (
    <table className="w-full border-collapse text-[9.5pt]">
      <thead>
        <tr>
          <Th>Item</Th>
          <Th>Name</Th>
          <Th>Client</Th>
          <Th>PO</Th>
          <Th>Ordered</Th>
          {showStage ? <Th>Stage</Th> : null}
          <Th align="right">Pending</Th>
          <Th>Due</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.poItemId}>
            <Td className="tabular-nums">{r.itemCode}</Td>
            <Td>{r.itemName}</Td>
            <Td>{r.clientCode}</Td>
            <Td className="tabular-nums">{r.poInternalNo}</Td>
            {/* The date the range filters on, on the sheet, so a filtered
                report can be checked against its own rows. */}
            <Td className="tabular-nums">{formatDate(r.poDate)}</Td>
            {showStage ? <Td>{r.currentStageName ?? "Not started"}</Td> : null}
            <Td className="text-right tabular-nums">{formatQty(r.pendingQty)}</Td>
            <Td>
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
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`border-b border-neutral-500 px-1 py-0.5 font-bold ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`border-b border-neutral-300 px-1 py-0.5 ${className ?? ""}`}>{children}</td>;
}
