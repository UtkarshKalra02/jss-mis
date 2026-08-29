import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
  className,
}: {
  label: string;
  value?: string;
  sub?: ReactNode;
  tone?: "neutral" | "overdue" | "at-risk" | "on-time";
  size?: "default" | "large";
  pendingPhase?: number;
  href?: string;
  className?: string;
}) {
  const pending = pendingPhase !== undefined;

  const toneClass = {
    neutral: "text-foreground",
    overdue: "text-overdue",
    "at-risk": "text-at-risk",
    "on-time": "text-on-time",
  }[tone];

  const body = (
    <>
      <p className="text-muted-foreground text-[12px] font-medium">{label}</p>

      <p
        className={cn(
          "mt-1.5 tabular-nums",
          size === "large" ? "text-4xl font-semibold tracking-tight" : "text-2xl font-semibold",
          pending ? "text-muted-foreground/40" : toneClass,
        )}
      >
        {pending ? "—" : (value ?? "—")}
      </p>

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
