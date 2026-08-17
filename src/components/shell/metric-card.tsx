import { cn } from "@/lib/utils";

/**
 * A dashboard tile.
 *
 * `pending` is the honest empty state: the metric exists in the design but the
 * data to compute it does not yet. It renders an em dash and the phase it
 * arrives in, rather than a zero — a zero would be a claim, and "0 overdue
 * items" is a very different statement from "we cannot tell you yet".
 */
export function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
  size = "default",
  pendingPhase,
  className,
}: {
  label: string;
  value?: string;
  sub?: string;
  tone?: "neutral" | "overdue" | "at-risk" | "on-time";
  size?: "default" | "large";
  pendingPhase?: number;
  className?: string;
}) {
  const pending = pendingPhase !== undefined;

  const toneClass = {
    neutral: "text-foreground",
    overdue: "text-overdue",
    "at-risk": "text-at-risk",
    "on-time": "text-on-time",
  }[tone];

  return (
    <div className={cn("rounded-lg border px-4 py-3.5", className)}>
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
    </div>
  );
}
