import { StagePill } from "@/components/stages/stage-pill";
import { formatDateTime } from "@/lib/format";
import type { TimelineEntry } from "@/modules/items/queries";

/**
 * The full stage history, newest first (spec 6.4).
 *
 * Every event, never a summary. stage_event is append-only, so a correction is
 * a further row rather than an edit to the wrong one — which means this list
 * occasionally shows a job moving backwards. That is the truth, not a bug:
 * backward moves are permitted deliberately (F4), because rework is real on a
 * shop floor and a system that cannot express it gets worked around.
 *
 * Each entry shows when it HAPPENED. Where that differs from when it was typed,
 * the gap is shown too — Ajay updates stages in batches, and the difference is
 * sometimes the evidence that settles an OTD dispute. Showing it only when the
 * two differ keeps it out of the way the rest of the time.
 */
export function StageTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-[13px]">
        No stage events yet. Every item gets a PO Received event when its purchase order is
        captured, so an empty timeline means this item predates that.
      </p>
    );
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => {
        // A minute's slack: entering an event as it happens is not "late".
        const typedLater =
          entry.createdAt.getTime() - entry.eventAt.getTime() > 60_000;

        return (
          <li key={entry.id} className="flex gap-3">
            {/* The rail. The last item's line is cut short so the timeline
                ends rather than trailing into nothing. */}
            <div className="flex flex-col items-center pt-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: entry.stageColour ?? "var(--muted-foreground)" }}
                aria-hidden
              />
              {index < entries.length - 1 ? (
                <span className="bg-border w-px grow" aria-hidden />
              ) : null}
            </div>

            <div className="min-w-0 grow pb-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <StagePill name={entry.stageName ?? entry.stageCode} colour={entry.stageColour} />
                <span className="text-[13px] tabular-nums">{formatDateTime(entry.eventAt)}</span>
                {entry.enteredByName ? (
                  <span className="text-muted-foreground text-[13px]">
                    {entry.enteredByName}
                  </span>
                ) : null}
                {entry.jobCardNo ? (
                  <span className="text-muted-foreground text-[11px] tabular-nums">
                    {entry.jobCardNo}
                  </span>
                ) : null}
              </div>

              {typedLater ? (
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  entered {formatDateTime(entry.createdAt)}
                </p>
              ) : null}

              {entry.remarks ? (
                <p className="mt-1 text-[13px]">{entry.remarks}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
