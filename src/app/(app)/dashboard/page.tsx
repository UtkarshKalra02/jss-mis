import type { Metadata } from "next";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { MetricCard } from "@/components/shell/metric-card";
import { taskCountsFor } from "@/modules/delegation/queries";

export const metadata: Metadata = { title: "Dashboard · JSS MIS" };

/**
 * The dashboard from section 6.1, laid out but not yet populated.
 *
 * Every tile here is real in shape and empty in content, because the data
 * behind it does not exist until orders and dispatches do (Phase 2 and 3).
 * They are shown rather than hidden so the layout is settled before real
 * numbers land in it — and each says which phase it arrives in, so nobody
 * mistakes an em dash for a broken query.
 *
 * Which tiles appear is decided by the role matrix, not by a second list:
 * AR follows the ar_ledger grant, enquiries follow the enquiry grant.
 */
export default async function DashboardPage() {
  const user = await requireAccess("dashboard");

  const showAr = can(user.role, "ar_ledger");
  const showEnquiries = can(user.role, "enquiry");

  // Real data, not a Phase placeholder — the delegation module is built, so
  // this tile either says a number or says zero, and both are true statements.
  const showTasks = can(user.role, "delegation");
  const tasks = showTasks ? await taskCountsFor(user.id) : { pending: 0, overdue: 0 };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Dashboard</h1>
        <p className="text-muted-foreground text-[13px]">
          {user.name} · {user.role.replace(/_/g, " ")}
        </p>
      </div>

      <p className="text-muted-foreground mt-1 text-[13px]">
        Phase 1 is the foundation — schema, auth, and the shell. Metrics fill in as the
        screens behind them are built.
      </p>

      {/* OTD is the headline number this system exists to produce, so it gets
          its own row at a larger size (section 6.1). */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="On-time delivery (30 days)"
          size="large"
          pendingPhase={3}
          className="sm:col-span-2"
        />
        <MetricCard label="Overdue items" tone="overdue" pendingPhase={3} />
        <MetricCard label="At risk (next 3 days)" tone="at-risk" pendingPhase={3} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Delegation (BMP week 9), and the only tile on this page carrying a
            REAL number — the module behind it is built, so it says a count
            rather than a phase. Shown even at zero, unlike the overdue-only
            card it replaces: pending tasks are a workload figure like "items in
            production", where nothing owed is a genuine and useful answer. An
            exception metric is what should stay hidden at zero; a workload one
            reads as broken when it disappears.

            Overdue rides underneath in red rather than colouring the number,
            because five pending of which two are late is not five late tasks.
            The whole tile links to My Tasks, which opens on exactly these. */}
        {showTasks ? (
          <MetricCard
            label="My pending tasks"
            value={String(tasks.pending)}
            href="/delegation"
            sub={
              tasks.overdue > 0 ? (
                <span className="text-overdue font-medium">
                  {tasks.overdue} overdue
                </span>
              ) : tasks.pending > 0 ? (
                "None overdue"
              ) : (
                "Nothing outstanding"
              )
            }
          />
        ) : null}

        <MetricCard label="Dispatched this month" pendingPhase={3} />
        <MetricCard label="Items in production" pendingPhase={2} />

        {showAr ? (
          <>
            <MetricCard label="AR outstanding" pendingPhase={5} />
            <MetricCard label="Overdue receivables" tone="overdue" pendingPhase={5} />
          </>
        ) : null}

        {showEnquiries ? <MetricCard label="Open enquiries" pendingPhase={2} /> : null}
      </div>

      <div className="mt-3 rounded-lg border px-4 py-3.5">
        <p className="text-muted-foreground text-[12px] font-medium">WIP by stage</p>
        <p className="text-muted-foreground/50 mt-6 mb-6 text-center text-[13px]">
          No items in production yet. This fills in once POs are being entered — Phase 2.
        </p>
      </div>
    </div>
  );
}
