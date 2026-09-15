import type { Metadata } from "next";
import Link from "next/link";
import { Printer } from "lucide-react";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { DayPicker } from "@/components/planning/day-picker";
import { DayPlan } from "@/components/planning/day-plan";
import { PlanningBoard } from "@/components/planning/planning-board";
import { Button } from "@/components/ui/button";
import { addDaysISO, todayIST } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { machineOptions } from "@/modules/job-cards/queries";
import { groupByStation } from "@/modules/planning/floor-plan";
import { dayPlan, itemsToPlan, plannedCountsBetween } from "@/modules/planning/queries";
import { listAllStages, runCardCounts } from "@/modules/stage-update/queries";

export const metadata: Metadata = { title: "Job planning · JSS MIS" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Tue 15 Sep" for the strip; the full date is in the picker beside it. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/**
 * Spec 6.6 — the 6pm meeting screen (M1–M3).
 *
 * Left: every open item, most urgent first, colour-coded by committed date,
 * with its card when it has one. Right: the chosen day — production by
 * station in the meeting's order, then the dispatch list — defaulting to
 * TOMORROW because that is the question the meeting is answering.
 *
 * PLANNER and ADMIN plan; OWNER sees the same board with no controls (B2).
 */
export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireAccess("job_planning");
  const canWrite = can(user.role, "job_planning", "write");

  const today = todayIST();
  const tomorrow = addDaysISO(today, 1);
  const { date: requested } = await searchParams;
  const date = requested && ISO_DATE.test(requested) ? requested : tomorrow;

  const [items, planned, weekCounts, stages, machines] = await Promise.all([
    itemsToPlan(),
    dayPlan(date),
    plannedCountsBetween(today, addDaysISO(today, 6)),
    listAllStages(),
    machineOptions(),
  ]);

  // "2 of 3 jobs shown" on a collapsed plate needs the plate's full count
  // (H8); skipped when nothing on the board is ganged, which is most days.
  const runIds = [...new Set(items.map((r) => r.pressRunId).filter((id): id is string => !!id))];
  const totals = Object.fromEntries(await runCardCounts(runIds));

  const stations = groupByStation(planned);
  const isPast = date < today;

  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDaysISO(today, i);
    const c = weekCounts.get(d);
    return { date: d, label: shortDay(d), production: c?.production ?? 0, dispatch: c?.dispatch ?? 0 };
  });

  const production = planned.filter((r) => r.kind === "Production").length;
  const dispatch = planned.length - production;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="page-title">Job planning</h1>
        <Button asChild size="sm" variant="outline">
          <Link href={`/planning/print?date=${date}`} target="_blank" rel="noopener">
            <Printer className="size-4" />
            Print floor plan
          </Link>
        </Button>
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Tick items, choose the station they go to, and add them to a day — or add them to
        that day&apos;s dispatch list. Reorder the day on the right; an urgent job goes first
        and the rest follow. A job card is not needed to plan a job.
      </p>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Open items</h2>
            <span className="text-muted-foreground text-[13px] tabular-nums">
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mt-3">
            <PlanningBoard
              rows={items}
              stages={stages}
              machines={machines.map((m) => ({ id: m.id, name: m.name }))}
              runCardTotals={totals}
              boardDate={date}
              canWrite={canWrite}
            />
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">
              {date === tomorrow ? "Tomorrow" : date === today ? "Today" : formatDate(date)}
              {date === tomorrow || date === today ? (
                <span className="text-muted-foreground ml-2 text-[13px] font-normal">
                  {formatDate(date)}
                </span>
              ) : null}
            </h2>
            <span className="text-muted-foreground text-[13px] tabular-nums">
              {production} job{production === 1 ? "" : "s"}
              {dispatch > 0 ? ` · ${dispatch} to dispatch` : ""}
            </span>
          </div>

          <div className="mt-3">
            <DayPicker
              date={date}
              today={today}
              strip={strip}
              prev={addDaysISO(date, -1)}
              next={addDaysISO(date, 1)}
            />
          </div>

          {isPast ? (
            <p className="text-muted-foreground mt-3 text-[12px]">
              A day that has passed is a record of what was planned on the floor; the dispatch
              list can still be changed.
            </p>
          ) : null}

          <div className="mt-3">
            <DayPlan
              stations={stations}
              canWrite={canWrite}
              nextDay={addDaysISO(date, 1)}
              isPast={isPast}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
