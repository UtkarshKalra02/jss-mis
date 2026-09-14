"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { StagePill } from "@/components/stages/stage-pill";
import { formatDate, formatDaysToCommitted, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { planCardsAction, type FormState } from "@/modules/planning/actions";
import type { Station } from "@/modules/planning/floor-plan";
import type { PlanningRow } from "@/modules/planning/queries";

const initialState: FormState = { ok: false, error: null };

/**
 * The right panel of spec 6.6 — the chosen day, grouped by station (L2).
 *
 * The grouping is `groupByStation`, the same function the printed floor plan
 * uses, so what the meeting sees on screen is what the floor gets on paper.
 * The only control is "take off", which clears the card's date and returns it
 * to the left; a card that needs a different day is taken off and planned
 * again, which is two clicks and one code path rather than a second form.
 */
export function DayPlan({
  stations,
  canWrite,
  isPast,
}: {
  stations: Station[];
  canWrite: boolean;
  /** A day already gone is a record, not a plan; nothing on it is editable. */
  isPast: boolean;
}) {
  if (stations.length === 0) {
    return (
      <p className="text-muted-foreground/60 rounded-lg border px-4 py-10 text-center text-[13px]">
        Nothing planned for this day. Tick cards on the left and plan them.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {stations.map((station) => (
        <section key={station.key ?? "__none"} className="rounded-lg border">
          <header className="bg-muted/40 flex items-center justify-between gap-3 border-b px-3 py-2">
            <StagePill name={station.name} colour={station.colour} />
            <span className="text-muted-foreground text-[12px] tabular-nums">
              {station.rows.length} job{station.rows.length === 1 ? "" : "s"} ·{" "}
              {formatQty(station.pendingQty)} pcs
            </span>
          </header>
          <ul>
            {station.rows.map((row) => (
              <PlannedCard key={row.jobCardId} row={row} canWrite={canWrite && !isPast} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Inside the form, so useFormStatus reads THIS form's pending state. */
function TakeOffSubmit({ jcNo }: { jcNo: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-muted-foreground hover:text-foreground text-[12px] hover:underline disabled:opacity-50"
      aria-label={`Take ${jcNo} off this day`}
    >
      {pending ? "…" : "Take off"}
    </button>
  );
}

function UnplanButton({ jobCardId, jcNo }: { jobCardId: string; jcNo: string }) {
  const [state, formAction] = useActionState(planCardsAction, initialState);

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="jobCardId" value={jobCardId} />
      <input type="hidden" name="plannedDate" value="" />
      <TakeOffSubmit jcNo={jcNo} />
      {state.error ? (
        <p role="alert" className="text-overdue mt-1 text-[11px]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function PlannedCard({ row, canWrite }: { row: PlanningRow; canWrite: boolean }) {
  const due = row.isOverdue
    ? "text-overdue font-medium"
    : row.isAtRisk
      ? "text-at-risk font-medium"
      : "text-muted-foreground";

  return (
    <li className="flex items-start justify-between gap-3 border-b px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate">
          <span className="font-medium">{row.itemName}</span>
          {row.itemCount > 1 ? (
            <span className="text-muted-foreground text-[12px]">
              {" "}
              +{row.itemCount - 1} more
            </span>
          ) : null}
        </p>
        <p className="text-muted-foreground text-[12px]">
          <Link href={`/job-cards/${row.jobCardId}`} className="text-primary tabular-nums hover:underline">
            {row.jcNo}
          </Link>
          {" · "}
          <span title={row.clientName}>{row.clientCode}</span>
          {row.clientCount > 1 ? ` +${row.clientCount - 1}` : ""}
          {" · "}
          <span className="tabular-nums">{formatQty(row.pendingQty)} pcs</span>
          {row.machineName ? ` · ${row.machineName}` : ""}
          {row.runNo ? ` · ${row.runNo}` : ""}
          {row.status !== "Planned" ? ` · ${row.status}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={cn("text-[12px] whitespace-nowrap", due)}>
          {row.committedDate
            ? `${formatDate(row.committedDate)} · ${formatDaysToCommitted(row.daysToCommitted)}`
            : "No commitment"}
        </span>
        {canWrite ? <UnplanButton jobCardId={row.jobCardId} jcNo={row.jcNo} /> : null}
      </div>
    </li>
  );
}
