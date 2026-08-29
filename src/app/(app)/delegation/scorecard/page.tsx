import type { Metadata } from "next";

import { requireAccess } from "@/auth/guard";
import { cn } from "@/lib/utils";
import { scorecard } from "@/modules/delegation/queries";

export const metadata: Metadata = { title: "Delegation scorecard · JSS MIS" };

/**
 * The executive meeting screen (BMP week 9).
 *
 * DESIGNED TO BE READ ALOUD. That single requirement drives everything here:
 * type is larger than anywhere else in the app, there is no interaction at all,
 * no filters, no sorting controls, no row actions. Somebody projects it and
 * talks through it, and every control on the screen would be a thing to
 * accidentally click while eight people watch.
 *
 * Ordered worst score first, so the conversation starts where it needs to
 * rather than wherever the alphabet puts it.
 *
 * ADMIN and OWNER only. It is a screen about people, and the people on it
 * should not have to discover their own number from a colleague's browser.
 */
export default async function ScorecardPage() {
  await requireAccess("delegation_scorecard");

  const rows = await scorecard();

  const total = rows.reduce(
    (acc, r) => ({
      assigned: acc.assigned + r.assigned,
      done: acc.done + r.done,
      onTime: acc.onTime + r.onTime,
      late: acc.late + r.late,
      open: acc.open + r.open,
      overdueNow: acc.overdueNow + r.overdueNow,
    }),
    { assigned: 0, done: 0, onTime: 0, late: 0, open: 0, overdueNow: 0 },
  );

  // Same rule as the view: no tasks means no score, not a score of zero.
  const totalPct =
    total.assigned === 0 ? null : Math.round((100 * total.onTime) / total.assigned);

  return (
    <div>
      <h1 className="page-title">Delegation scorecard</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        On-time completion of one-time delegated tasks. Cancelled tasks are excluded —
        withdrawn work is not missed work. Score is on-time out of everything assigned, so
        finishing nothing scores nothing.
      </p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-8 rounded-lg border border-dashed p-8 text-center text-sm">
          Nothing has been delegated yet. The scorecard fills in as tasks are assigned and
          their dates pass.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left">
                <th className="text-muted-foreground px-4 py-3 text-[12px] font-medium uppercase">
                  Person
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right text-[12px] font-medium uppercase">
                  Score
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right text-[12px] font-medium uppercase">
                  Assigned
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right text-[12px] font-medium uppercase">
                  On time
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right text-[12px] font-medium uppercase">
                  Late
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right text-[12px] font-medium uppercase">
                  Open
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right text-[12px] font-medium uppercase">
                  Overdue now
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.appUserId} className="border-b last:border-0">
                  <td className="px-4 py-4 text-[17px] font-medium">{r.name}</td>
                  <td
                    className={cn(
                      "px-4 py-4 text-right text-[28px] font-semibold tabular-nums",
                      r.scorePct === null && "text-muted-foreground/40",
                      r.scorePct !== null && r.scorePct >= 80 && "text-on-time",
                      r.scorePct !== null && r.scorePct >= 50 && r.scorePct < 80 && "text-at-risk",
                      r.scorePct !== null && r.scorePct < 50 && "text-overdue",
                    )}
                  >
                    {/* Em dash, never 0%. "No score yet" and "scored zero" are
                        different statements, and this one is read out loud. */}
                    {r.scorePct === null ? "—" : `${r.scorePct}%`}
                  </td>
                  <td className="px-4 py-4 text-right text-[17px] tabular-nums">{r.assigned}</td>
                  <td className="text-on-time px-4 py-4 text-right text-[17px] tabular-nums">
                    {r.onTime}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-4 text-right text-[17px] tabular-nums",
                      r.late > 0 && "text-overdue",
                    )}
                  >
                    {r.late}
                  </td>
                  <td className="px-4 py-4 text-right text-[17px] tabular-nums">{r.open}</td>
                  <td
                    className={cn(
                      "px-4 py-4 text-right text-[17px] tabular-nums",
                      r.overdueNow > 0 && "text-overdue font-semibold",
                    )}
                  >
                    {r.overdueNow}
                  </td>
                </tr>
              ))}

              <tr className="bg-neutral-status-bg">
                <td className="px-4 py-4 text-[17px] font-semibold">Everyone</td>
                <td
                  className={cn(
                    "px-4 py-4 text-right text-[28px] font-semibold tabular-nums",
                    totalPct === null && "text-muted-foreground/40",
                    totalPct !== null && totalPct >= 80 && "text-on-time",
                    totalPct !== null && totalPct >= 50 && totalPct < 80 && "text-at-risk",
                    totalPct !== null && totalPct < 50 && "text-overdue",
                  )}
                >
                  {totalPct === null ? "—" : `${totalPct}%`}
                </td>
                <td className="px-4 py-4 text-right text-[17px] font-semibold tabular-nums">
                  {total.assigned}
                </td>
                <td className="px-4 py-4 text-right text-[17px] font-semibold tabular-nums">
                  {total.onTime}
                </td>
                <td className="px-4 py-4 text-right text-[17px] font-semibold tabular-nums">
                  {total.late}
                </td>
                <td className="px-4 py-4 text-right text-[17px] font-semibold tabular-nums">
                  {total.open}
                </td>
                <td className="px-4 py-4 text-right text-[17px] font-semibold tabular-nums">
                  {total.overdueNow}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* The total is recomputed from the rows rather than read from a second
          view, so it cannot disagree with the column above it. */}
      <p className="text-muted-foreground mt-4 text-[12px]">
        A person with nothing assigned shows “—”, not 0%.
      </p>
    </div>
  );
}
