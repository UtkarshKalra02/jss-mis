import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { MetricCard } from "@/components/shell/metric-card";
import { cn } from "@/lib/utils";
import { overdueCountFor } from "@/modules/delegation/queries";

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
  const overdueTasks = can(user.role, "delegation") ? await overdueCountFor(user.id) : 0;

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

      {/* Delegation (BMP week 9). Placed above WIP because it is about the
          person reading the screen rather than about the factory, and because a
          commitment somebody has already missed outranks a chart. Rendered only
          when there is something to say: a permanent "0 overdue tasks" tile
          trains people to stop reading it, which is the opposite of the point. */}
      {can(user.role, "delegation") && overdueTasks > 0 ? (
        <Link
          href="/delegation"
          className={cn(
            "border-overdue/40 mt-3 flex items-baseline gap-3 rounded-lg border px-4 py-3.5",
            "hover:bg-overdue/5 transition-colors",
          )}
        >
          <span className="text-overdue text-2xl font-semibold tabular-nums">
            {overdueTasks}
          </span>
          <span className="text-[13px]">
            overdue {overdueTasks === 1 ? "task is" : "tasks are"} assigned to you.{" "}
            <span className="text-primary">Open my tasks →</span>
          </span>
        </Link>
      ) : null}

      <div className="mt-3 rounded-lg border px-4 py-3.5">
        <p className="text-muted-foreground text-[12px] font-medium">WIP by stage</p>
        <p className="text-muted-foreground/50 mt-6 mb-6 text-center text-[13px]">
          No items in production yet. This fills in once POs are being entered — Phase 2.
        </p>
      </div>
    </div>
  );
}
