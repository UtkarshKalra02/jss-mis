import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The trend beside a metric.
 *
 * `direction` is what the arrow points at; `label` says what it is measuring.
 * Both are supplied by the caller rather than derived from two numbers here,
 * because the caller is the only thing that knows whether the comparison was
 * worth making at all — see MIN_FOR_TREND in the dashboard queries. A tile
 * given no trend simply shows none, which is the honest rendering of "not
 * enough data to say".
 */
export type Trend = { direction: "up" | "down" | "flat"; label: string };

/**
 * A dashboard tile.
 *
 * `pending` is the honest empty state: the metric exists in the design but the
 * data to compute it does not yet. It renders an em dash and the phase it
 * arrives in, rather than a zero — a zero would be a claim, and "0 overdue
 * items" is a very different statement from "we cannot tell you yet".
 *
 * `href` makes the tile a link. Spec 6.1 asks for "count + clickable list" on
 * most of these, so the whole card is the target rather than a small "view"
 * link in a corner — a number somebody is already looking at is the thing they
 * will click.
 *
 * `sub` takes a node rather than a string so a tile can carry a second,
 * differently-coloured fact underneath its number ("2 overdue" in red beneath a
 * neutral count). Colouring the big number instead would be a lie: 5 pending
 * tasks of which 2 are late is not 5 late tasks.
 */
export function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
  size = "default",
  pendingPhase,
  href,
  trend,
  className,
}: {
  label: string;
  value?: string;
  sub?: ReactNode;
  tone?: "neutral" | "overdue" | "at-risk" | "on-time";
  size?: "default" | "large";
  pendingPhase?: number;
  href?: string;
  trend?: Trend | null;
  className?: string;
}) {
  const pending = pendingPhase !== undefined;

  const toneClass = {
    neutral: "text-foreground",
    overdue: "text-overdue",
    "at-risk": "text-at-risk",
    "on-time": "text-on-time",
  }[tone];

  /* Semantic colour only (section 7): a rising OTD is on-time green, a falling
     one is overdue red, and a flat one is not coloured at all. The arrow is
     never decorative — if there is no trend, there is no arrow. */
  const TrendIcon =
    trend?.direction === "up"
      ? ArrowUpRight
      : trend?.direction === "down"
        ? ArrowDownRight
        : ArrowRight;

  const trendClass = {
    up: "text-on-time",
    down: "text-overdue",
    flat: "text-muted-foreground",
  }[trend?.direction ?? "flat"];

  const body = (
    <>
      <p className="text-muted-foreground text-[12px] font-medium">{label}</p>

      <div className="mt-1.5 flex items-baseline gap-2">
        <p
          className={cn(
            "tabular-nums",
            size === "large" ? "text-4xl font-semibold tracking-tight" : "text-2xl font-semibold",
            pending ? "text-muted-foreground/40" : toneClass,
          )}
        >
          {pending ? "—" : (value ?? "—")}
        </p>

        {!pending && trend ? (
          <span className={cn("flex items-center gap-0.5 text-[12px] font-medium", trendClass)}>
            <TrendIcon className="size-3.5" strokeWidth={2.25} />
            <span className="tabular-nums">{trend.label}</span>
          </span>
        ) : null}
      </div>

      <p className="text-muted-foreground/70 mt-1 text-[11px]">
        {pending ? `Arrives in Phase ${pendingPhase}` : sub}
      </p>
    </>
  );

  const box = cn("rounded-lg border px-4 py-3.5", className);

  // A pending tile is not clickable, whatever href says: there is nothing on
  // the other side of it yet, and a link to an empty screen is worse than none.
  if (href && !pending) {
    return (
      <Link href={href} className={cn(box, "hover:border-primary/40 block transition-colors")}>
        {body}
      </Link>
    );
  }

  return <div className={box}>{body}</div>;
}
