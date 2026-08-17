import type { Metadata } from "next";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { MetricCard } from "@/components/shell/metric-card";

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

      <div className="mt-3 rounded-lg border px-4 py-3.5">
        <p className="text-muted-foreground text-[12px] font-medium">WIP by stage</p>
        <p className="text-muted-foreground/50 mt-6 mb-6 text-center text-[13px]">
          No items in production yet. This fills in once POs are being entered — Phase 2.
        </p>
      </div>
    </div>
  );
}
