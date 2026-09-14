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
import { groupByStation } from "@/modules/planning/floor-plan";
import {
  cardsToPlan,
  dayPlan,
  plannedCountsBetween,
  runCardTotals,
  unreleasedItemCount,
} from "@/modules/planning/queries";

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
 * Spec 6.6 — the 6pm meeting screen (L1).
 *
 * Two panels. Left: job cards that need a day — undated, or planned for a day
 * that has passed and still open — most urgent first, colour-coded by the
 * committed date of the most urgent item each covers. Right: the chosen day,
 * grouped by station, which defaults to TOMORROW because that is the question
 * the meeting is answering.
 *
 * PLANNER and ADMIN plan; OWNER sees the same board with no controls (B2).
 * Items nobody has raised a card for yet cannot be planned from here — there
 * is nothing to date — so they are counted and the release screen is linked.
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
  // A mistyped date shows tomorrow rather than an empty day headed with junk.
  const date = requested && ISO_DATE.test(requested) ? requested : tomorrow;

  const [toPlan, planned, weekCounts, unreleased] = await Promise.all([
    cardsToPlan(),
    dayPlan(date),
    plannedCountsBetween(today, addDaysISO(today, 6)),
    unreleasedItemCount(),
  ]);

  // "2 of 3 jobs shown" on a collapsed plate needs the plate's full count
  // (H8); skipped when nothing on the board is ganged, which is most days.
  const runIds = [...new Set(toPlan.map((r) => r.pressRunId).filter((id): id is string => !!id))];
  const totals = Object.fromEntries(await runCardTotals(runIds));

  const stations = groupByStation(planned);
  const slipped = toPlan.filter((r) => r.plannedDate !== null).length;
  const isPast = date < today;

  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDaysISO(today, i);
    return { date: d, label: shortDay(d), cards: weekCounts.get(d) ?? 0 };
  });

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
        Tick the job cards that run on a day and plan them. Cards printed together on one
        plate are grouped — open the run to plan any of them, and the run moves with them
        when all are planned together.
      </p>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Needs a day</h2>
            <span className="text-muted-foreground text-[13px] tabular-nums">
              {toPlan.length} card{toPlan.length === 1 ? "" : "s"}
              {slipped > 0 ? ` · ${slipped} slipped` : ""}
            </span>
          </div>

          <div className="mt-3">
            <PlanningBoard
              rows={toPlan}
              runCardTotals={totals}
              boardDate={date}
              canWrite={canWrite}
            />
          </div>

          {/* Work the board cannot see: items with no card. Counted rather
              than listed, and pointed at the screen that can do something
              about it. */}
          {unreleased > 0 ? (
            <p className="text-muted-foreground mt-3 text-[13px]">
              {unreleased} open item{unreleased === 1 ? " has" : "s have"} no job card yet and
              cannot be planned from here.{" "}
              {can(user.role, "job_card", "write") ? (
                <Link href="/job-cards/new" className="text-primary hover:underline">
                  Release a card
                </Link>
              ) : (
                <Link href="/items" className="text-primary hover:underline">
                  See them in the tracker
                </Link>
              )}
              .
            </p>
          ) : null}
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
              {planned.length} card{planned.length === 1 ? "" : "s"}
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
              A day that has passed is a record of what was planned; it cannot be changed here.
            </p>
          ) : null}

          <div className="mt-3">
            <DayPlan stations={stations} canWrite={canWrite} isPast={isPast} />
          </div>
        </section>
      </div>
    </div>
  );
}
