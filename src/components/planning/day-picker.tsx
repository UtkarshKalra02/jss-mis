"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Which day the right panel shows. THE DAY LIVES IN THE URL (F22), so the
 * board somebody has open at 6pm can be refreshed, sent, or printed without
 * losing its place — the print link carries the same `?date=`.
 *
 * The seven-day strip is the week at a glance: how many cards each day
 * already holds, so "tomorrow is full, push it to Thursday" is a decision made
 * from the screen rather than from paging through it.
 */
export function DayPicker({
  date,
  today,
  strip,
  prev,
  next,
}: {
  date: string;
  today: string;
  /** Seven days from today, each with the cards already planned on it. */
  strip: { date: string; label: string; cards: number }[];
  prev: string;
  next: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Link
          href={`/planning?date=${prev}`}
          className="hover:bg-muted rounded-md p-1.5"
          aria-label="Previous day"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) router.push(`/planning?date=${e.target.value}`);
          }}
          className="border-input bg-background h-9 rounded-md border px-2 text-[13px] tabular-nums focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
          aria-label="Day to plan"
        />
        <Link
          href={`/planning?date=${next}`}
          className="hover:bg-muted rounded-md p-1.5"
          aria-label="Next day"
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <ol className="flex flex-wrap gap-1">
        {strip.map((d) => (
          <li key={d.date}>
            <Link
              href={`/planning?date=${d.date}`}
              aria-current={d.date === date ? "date" : undefined}
              className={cn(
                "flex min-w-14 flex-col items-center rounded-md border px-2 py-1 text-[12px] leading-tight",
                d.date === date
                  ? "border-primary bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span>{d.date === today ? "Today" : d.label}</span>
              <span className="tabular-nums">{d.cards === 0 ? "·" : d.cards}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
