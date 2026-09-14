import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { openEnquiryCount } from "@/modules/enquiries/queries";
import { MetricCard, type Trend } from "@/components/shell/metric-card";
import { todayIST } from "@/lib/dates";
import { formatDate, formatINR, formatPercent, formatQty } from "@/lib/format";
import {
  dispatchedThisMonth,
  otdSummary,
  todaysDispatch,
  wipByStage,
  workloadCounts,
  type TodaysDispatch,
  type WipStage,
} from "@/modules/dashboard/queries";
import { taskCountsFor } from "@/modules/delegation/queries";
import { getAtRiskWindowDays } from "@/modules/stages/queries";

export const metadata: Metadata = { title: "Dashboard · JSS MIS" };

/**
 * The dashboard from section 6.1.
 *
 * EVERY TILE IS EITHER REAL OR HONESTLY EMPTY. There is no middle state: a
 * tile either reads a number from a source that exists, or renders an em dash
 * and names the phase its data arrives in. What it must never do is show a
 * figure that means something narrower than its label — a half-wired tile is
 * worse than a blank one, because nobody can tell it is half-wired by looking.
 *
 * WIRED, from views that have existed since Phase 1 and were read by nothing:
 * OTD, overdue, at risk, items in production, dispatched this month, WIP by
 * stage.
 *
 * STILL BLANK, because no row exists to count: AR outstanding and overdue
 * receivables need `invoice` and `receipt`, which no code in the system writes
 * (Phase 5); open enquiries needs `enquiry`, likewise (Phase 3).
 *
 * Which tiles appear at all is decided by the role matrix, not a second list.
 */
export default async function DashboardPage() {
  const user = await requireAccess("dashboard");

  const showAr = can(user.role, "ar_ledger");
  const showEnquiries = can(user.role, "enquiry");
  const showTasks = can(user.role, "delegation");
  const canSeeItems = can(user.role, "item_tracker");
  const canSeeDispatch = can(user.role, "dispatch");

  // One round of parallel reads. Each is a single aggregate query; running
  // them in sequence would put five Neon round trips end to end on the first
  // screen everybody opens.
  const [otd, workload, dispatched, wip, today, atRiskWindowDays, tasks, openEnquiries] =
    await Promise.all([
    otdSummary(),
    workloadCounts(),
    dispatchedThisMonth(),
    wipByStage(),
    todaysDispatch(),
    getAtRiskWindowDays(),
    showTasks ? taskCountsFor(user.id) : Promise.resolve({ pending: 0, overdue: 0 }),
    showEnquiries ? openEnquiryCount() : Promise.resolve(0),
  ]);

  /*
   * The trend, or nothing at all.
   *
   * `changePoints` is null whenever either window is too thin to compare, and
   * that null travels all the way to the card as an absent arrow. Rendering a
   * flat arrow instead would be a claim that performance held steady, which is
   * a different statement from "there were three deliveries last month".
   */
  const trend: Trend | null =
    otd.changePoints === null
      ? null
      : {
          direction:
            Math.abs(otd.changePoints) < 0.05
              ? "flat"
              : otd.changePoints > 0
                ? "up"
                : "down",
          label:
            Math.abs(otd.changePoints) < 0.05
              ? "level"
              : `${otd.changePoints > 0 ? "+" : "−"}${Math.abs(otd.changePoints).toFixed(1)} pts`,
        };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Dashboard</h1>
        <p className="text-muted-foreground text-[13px]">
          {user.name} · {user.role.replace(/_/g, " ")}
        </p>
      </div>

      <p className="text-muted-foreground mt-1 text-[13px]">
        Delivery and production are live. Accounts figures arrive with Phase 5.
      </p>

      {/* OTD is the headline number this system exists to produce, so it gets
          its own row at a larger size (section 6.1). */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="On-time delivery (30 days)"
          size="large"
          className="sm:col-span-2"
          value={otd.current.percent === null ? "—" : formatPercent(otd.current.percent)}
          trend={trend}
          sub={
            otd.current.total === 0
              ? "No deliveries completed in the last 30 days."
              : `${formatQty(otd.current.onTime)} of ${formatQty(otd.current.total)} items delivered on time` +
                // Deliberately not "too few in the previous 30 days": the
                // comparison is suppressed when EITHER window is thin, and
                // naming the wrong one sends somebody looking at the wrong
                // month for an explanation.
                (otd.changePoints === null
                  ? ` · too few deliveries to compare with the previous 30 days`
                  : ` · previous 30 days ${formatPercent(otd.previous.percent)}`)
          }
        />

        <MetricCard
          label="Overdue items"
          tone="overdue"
          value={formatQty(workload.overdue)}
          href={canSeeItems ? "/items?risk=overdue" : undefined}
          sub={
            workload.overdue === 0
              ? "Nothing past its committed date."
              : "Committed date passed, quantity still owed"
          }
        />

        {/* The window is a setting the Admin screen can change (B3), so the
            LABEL reads it rather than saying "3 days" and becoming wrong the
            first time somebody edits it. */}
        <MetricCard
          label={`At risk (next ${atRiskWindowDays} day${atRiskWindowDays === 1 ? "" : "s"})`}
          tone="at-risk"
          value={formatQty(workload.atRisk)}
          href={canSeeItems ? "/items?risk=at-risk" : undefined}
          sub={
            workload.atRisk === 0
              ? "Nothing due inside the window."
              : "Committed soon and not yet ready"
          }
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Delegation (BMP week 9). Shown even at zero, unlike an exception
            metric: pending tasks are a workload figure, where nothing owed is
            a genuine answer and a disappearing tile reads as broken (G9). */}
        {showTasks ? (
          <MetricCard
            label="My pending tasks"
            value={String(tasks.pending)}
            href="/delegation"
            sub={
              tasks.overdue > 0 ? (
                <span className="text-overdue font-medium">{tasks.overdue} overdue</span>
              ) : tasks.pending > 0 ? (
                "None overdue"
              ) : (
                "Nothing outstanding"
              )
            }
          />
        ) : null}

        <MetricCard
          label="Dispatched this month"
          value={dispatched.value === null ? "—" : formatINR(dispatched.value)}
          sub={
            dispatched.items === 0
              ? "Nothing has gone out this month."
              : `${formatQty(dispatched.items)} item${dispatched.items === 1 ? "" : "s"} on ${formatQty(dispatched.challans)} challan${dispatched.challans === 1 ? "" : "s"}` +
                // Counted in the item total, excluded from the value. A total
                // that quietly omits revenue is worse than one that says so.
                (dispatched.linesWithoutRate > 0
                  ? ` · ${dispatched.linesWithoutRate} line${dispatched.linesWithoutRate === 1 ? "" : "s"} with no rate, not valued`
                  : "")
          }
        />

        {/* is_process is what separates work happening to paper from points in
            an order's life (F18), so an item at PO_RECEIVED or READY is open
            but is not on the floor. */}
        <MetricCard
          label="Items in production"
          value={formatQty(workload.inProduction)}
          href={canSeeItems ? "/items" : undefined}
          sub={`of ${formatQty(workload.open)} open item${workload.open === 1 ? "" : "s"}`}
        />

        {showAr ? (
          <>
            <MetricCard label="AR outstanding" pendingPhase={5} />
            <MetricCard label="Overdue receivables" tone="overdue" pendingPhase={5} />
          </>
        ) : null}

        {/* Phase 3, matching nav.ts. It was marked Phase 2 here while nav said
            3, which is the kind of disagreement that makes a reader trust
            neither. */}
        {/* Wired now that the register writes rows. Clicking goes to the
            register already filtered, which is the ?risk= pattern the tracker
            tiles use — one mechanism for "a tile is a saved view", not two. */}
        {showEnquiries ? (
          <MetricCard
            label="Open enquiries"
            value={formatQty(openEnquiries)}
            href="/enquiries?status=Open"
            sub={
              openEnquiries === 0
                ? "Nothing waiting on an answer."
                : "Asked for, not yet won, lost or dropped."
            }
          />
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* Everyday's dispatch (L5): what left today and what was promised
            for today. Every role sees the figures; the challan links need the
            Dispatch grant, and the due-today link the tracker's. */}
        <TodayPanel today={today} canSeeDispatch={canSeeDispatch} canSeeItems={canSeeItems} />

        <div className="rounded-lg border px-4 py-3.5">
          <p className="text-muted-foreground text-[12px] font-medium">WIP by stage</p>
          <WipBars stages={wip} />
        </div>
      </div>
    </div>
  );
}

/**
 * Today's dispatch — the panel Utkarsh asked for on the dashboard itself.
 *
 * TWO FACTS, KEPT APART. What went out is a list of challans with pieces and
 * items; what was promised is a count of open items committed for today, with
 * how many of them are not yet READY. Neither is folded into the other, and a
 * Draft challan is listed with its status and left out of the totals — see
 * `todaysDispatch`.
 */
function TodayPanel({
  today,
  canSeeDispatch,
  canSeeItems,
}: {
  today: TodaysDispatch;
  canSeeDispatch: boolean;
  canSeeItems: boolean;
}) {
  const sent = today.challans.filter((c) => c.status === "Dispatched").length;

  return (
    <div className="rounded-lg border px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <p className="text-muted-foreground text-[12px] font-medium">Today&apos;s dispatch</p>
        <p className="text-muted-foreground text-[12px] tabular-nums">{formatDate(todayIST())}</p>
      </div>

      <p className="mt-2 text-[22px] leading-none font-semibold tracking-tight tabular-nums">
        {formatQty(today.qty)}
        <span className="text-muted-foreground ml-1.5 text-[13px] font-normal">
          pcs
          {sent > 0
            ? ` · ${formatQty(today.items)} item${today.items === 1 ? "" : "s"} on ${sent} challan${sent === 1 ? "" : "s"}`
            : ""}
        </span>
      </p>

      {/* Due today. A neutral fact with a coloured second half: some of these
          are READY and going out tonight, and "not yet ready" is the part
          somebody has to act on. */}
      <p className="text-muted-foreground mt-1.5 text-[13px]">
        {today.dueToday === 0 ? (
          "Nothing committed for today."
        ) : (
          <>
            {canSeeItems ? (
              <Link href="/items?risk=due-today" className="text-foreground hover:underline">
                {today.dueToday} item{today.dueToday === 1 ? "" : "s"} committed for today
              </Link>
            ) : (
              <span className="text-foreground">
                {today.dueToday} item{today.dueToday === 1 ? "" : "s"} committed for today
              </span>
            )}
            {today.dueTodayNotReady > 0 ? (
              <span className="text-at-risk font-medium">
                {" "}
                · {today.dueTodayNotReady} not yet ready
              </span>
            ) : (
              <span className="text-on-time"> · all ready or gone</span>
            )}
          </>
        )}
      </p>

      {today.challans.length === 0 ? (
        <p className="text-muted-foreground/50 mt-4 mb-2 text-center text-[13px]">
          Nothing has gone out yet today.
        </p>
      ) : (
        <ul className="mt-3 divide-y border-t">
          {today.challans.map((c) => (
            <li key={c.dispatchId} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <div className="min-w-0">
                <p className="truncate">
                  {canSeeDispatch ? (
                    <Link href={`/dispatch/${c.dispatchId}`} className="text-primary tabular-nums hover:underline">
                      {c.challanNo}
                    </Link>
                  ) : (
                    <span className="tabular-nums">{c.challanNo}</span>
                  )}
                  <span className="ml-2" title={c.clientName}>
                    {c.clientCode}
                  </span>
                  {c.firstItemName ? (
                    <span className="text-muted-foreground">
                      {" · "}
                      {c.firstItemName}
                      {c.items > 1 ? ` +${c.items - 1}` : ""}
                    </span>
                  ) : null}
                  {c.status === "Draft" ? (
                    <span className="text-muted-foreground ml-2 text-[11px] uppercase">draft</span>
                  ) : null}
                </p>
              </div>
              <span className="shrink-0 tabular-nums">{formatQty(c.qty)} pcs</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Section 6.1's horizontal bar.
 *
 * COUNTS ONLY. `v_wip_ageing` can also report which items are past their
 * stage's target hours, and that is deliberately not shown: every seeded target
 * is an unmeasured placeholder (A2), so an "over target" marker would be a
 * confident red claim derived from a number nobody has checked. It becomes
 * worth adding on the day somebody measures them on the floor.
 *
 * Bars are drawn against the busiest stage rather than the total, because the
 * question is "where is the work piling up", and against a total every bar in
 * a fourteen-stage factory is a sliver.
 */
function WipBars({ stages }: { stages: WipStage[] }) {
  if (stages.length === 0) {
    return (
      <p className="text-muted-foreground/50 mt-6 mb-6 text-center text-[13px]">
        Nothing in production. Items appear here once they have a stage and quantity still
        owed.
      </p>
    );
  }

  const busiest = Math.max(...stages.map((s) => s.items));

  return (
    <ul className="mt-3 space-y-1.5">
      {stages.map((s) => (
        <li key={s.code} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-[13px]">{s.name ?? s.code}</span>

          <span className="bg-muted h-4 min-w-px grow overflow-hidden rounded-sm">
            <span
              className="block h-full rounded-sm"
              style={{
                // The stage's own colour, from the stage table. Never a
                // hardcoded map (non-negotiable 5).
                backgroundColor: s.colour ?? "var(--color-primary)",
                width: `${Math.max((s.items / busiest) * 100, 2)}%`,
              }}
            />
          </span>

          <span className="w-10 shrink-0 text-right text-[13px] tabular-nums">
            {formatQty(s.items)}
          </span>
        </li>
      ))}
    </ul>
  );
}
