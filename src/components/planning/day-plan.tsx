"use client";

import { ArrowDown, ArrowUp, ChevronsUp, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { StagePill } from "@/components/stages/stage-pill";
import { formatDate, formatDaysToCommitted, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  movePlanEntryAction,
  pushPlanEntryAction,
  removePlanEntryAction,
  updatePlanQtyAction,
  type FormState,
} from "@/modules/planning/actions";
import type { Station } from "@/modules/planning/floor-plan";
import type { PlanEntryRow } from "@/modules/planning/queries";

const initialState: FormState = { ok: false, error: null };

/**
 * The right panel of spec 6.6 — the chosen day, by station, in the order the
 * meeting put it (M2), with the day's dispatch list last (M3).
 *
 * `groupByStation` is the same function the printed floor plan uses, so what
 * the meeting sees is what the floor gets. The controls are the queue: up,
 * down, to the top, push to the next day, take off — and on a dispatch line,
 * the quantity. Each is its own tiny form so one click is one write.
 */
export function DayPlan({
  stations,
  canWrite,
  nextDay,
  isPast,
}: {
  stations: Station[];
  canWrite: boolean;
  /** Where "push" sends a line. */
  nextDay: string;
  /**
   * A production plan for a day already gone is a record and is not editable.
   * THE DISPATCH LIST IS EDITABLE ANY DAY (M3, amended): it is the factory's
   * own note of what goes out, it never writes a challan, and Utkarsh asked
   * that it be changeable at any time.
   */
  isPast: boolean;
}) {

  if (stations.length === 0) {
    return (
      <p className="text-muted-foreground/60 rounded-lg border px-4 py-10 text-center text-[13px]">
        Nothing planned for this day. Tick items on the left and add them.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {stations.map((station) => (
        <section key={station.key} className="rounded-lg border">
          <header className="bg-muted/40 flex items-center justify-between gap-3 border-b px-3 py-2">
            {station.kind === "Dispatch" ? (
              <span className="text-[13px] font-semibold">Dispatch</span>
            ) : (
              <StagePill name={station.name} colour={station.colour} />
            )}
            <span className="text-muted-foreground text-[12px] tabular-nums">
              {station.rows.length} job{station.rows.length === 1 ? "" : "s"} ·{" "}
              {formatQty(station.pendingQty)} pcs
            </span>
          </header>
          <ol>
            {station.rows.map((row, i) => (
              <PlannedLine
                key={row.entryId}
                row={row}
                position={i + 1}
                count={station.rows.length}
                editable={canWrite && (station.kind === "Dispatch" || !isPast)}
                nextDay={nextDay}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One line                                                                    */
/* -------------------------------------------------------------------------- */

function IconSubmit({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      title={label}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** One control = one form = one write. */
function Control({
  action,
  entryId,
  fields,
  label,
  children,
  onError,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  entryId: string;
  fields: Record<string, string>;
  label: string;
  children: React.ReactNode;
  onError: (message: string | null) => void;
}) {
  const [state, formAction] = useActionState(action, initialState);
  useEffect(() => onError(state.error), [state, onError]);
  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="entryId" value={entryId} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <IconSubmit label={label}>{children}</IconSubmit>
    </form>
  );
}

function QtyForm({ row, onError }: { row: PlanEntryRow; onError: (m: string | null) => void }) {
  const [state, formAction] = useActionState(updatePlanQtyAction, initialState);
  const [qty, setQty] = useState(String(row.plannedQty ?? ""));
  useEffect(() => onError(state.error), [state, onError]);
  useEffect(() => setQty(String(row.plannedQty ?? "")), [row.plannedQty]);

  const changed = qty !== String(row.plannedQty ?? "");

  return (
    <form action={formAction} className="inline-flex items-center gap-1">
      <input type="hidden" name="entryId" value={row.entryId} />
      <input
        type="number"
        name="plannedQty"
        min={1}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="border-input bg-background h-7 w-20 rounded-md border px-1.5 text-right text-[12px] tabular-nums"
        aria-label={`Quantity to dispatch for ${row.itemCode}`}
      />
      <span className="text-muted-foreground text-[11px]">of {formatQty(row.pendingQty)}</span>
      {changed ? <QtySubmit /> : null}
    </form>
  );
}

function QtySubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-primary text-[12px] hover:underline disabled:opacity-50"
    >
      {pending ? "…" : "Save"}
    </button>
  );
}

function PlannedLine({
  row,
  position,
  count,
  editable,
  nextDay,
}: {
  row: PlanEntryRow;
  position: number;
  count: number;
  editable: boolean;
  nextDay: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const due = row.isOverdue
    ? "text-overdue font-medium"
    : row.isAtRisk
      ? "text-at-risk font-medium"
      : "text-muted-foreground";

  // An item delivered or closed since it was planned: the line stays, and says so.
  const stale = row.itemStatus !== "Open" || row.pendingQty <= 0;

  return (
    <li className={cn("border-b px-3 py-2 last:border-b-0", stale && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span className="text-muted-foreground w-5 shrink-0 pt-0.5 text-right text-[12px] tabular-nums">
          {position}
        </span>

        <div className="min-w-0 grow">
          <p className="truncate">
            <Link href={`/items/${row.poItemId}`} className="font-medium hover:underline">
              {row.itemName}
            </Link>
            {stale ? (
              <span className="text-muted-foreground ml-2 text-[11px]">
                {row.itemStatus !== "Open" ? row.itemStatus.toLowerCase() : "delivered"}
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground text-[12px]">
            <span className="tabular-nums">{row.itemCode}</span>
            {" · "}
            <span title={row.clientName}>{row.clientCode}</span>
            {row.jcNo ? (
              <>
                {" · "}
                <Link href={`/job-cards/${row.jobCardId}`} className="text-primary tabular-nums hover:underline">
                  {row.jcNo}
                </Link>
              </>
            ) : (
              " · no card yet"
            )}
            {row.kind === "Production" ? (
              <>
                {row.machineName ? ` · ${row.machineName}` : ""}
                {" · "}
                <span className="tabular-nums">{formatQty(row.pendingQty)} pcs</span>
                {row.currentStage && row.currentStage !== row.stageCode ? (
                  <>
                    {" · now at "}
                    <StagePill
                      name={row.currentStageName}
                      colour={row.currentStageColour}
                      className="align-middle"
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </p>
          {row.kind === "Dispatch" ? (
            <div className="mt-1">
              {editable ? (
                <QtyForm row={row} onError={setError} />
              ) : (
                <span className="text-[12px] tabular-nums">
                  {formatQty(row.plannedQty)} of {formatQty(row.pendingQty)} pcs
                </span>
              )}
              {row.currentStageName ? (
                <span className="text-muted-foreground ml-2 text-[11px]">
                  now at {row.currentStageName}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("text-[12px] whitespace-nowrap", due)}>
            {row.committedDate
              ? `${formatDate(row.committedDate)} · ${formatDaysToCommitted(row.daysToCommitted)}`
              : "No commitment"}
          </span>

          {editable ? (
            <div className="flex items-center">
              <Control
                action={movePlanEntryAction}
                entryId={row.entryId}
                fields={{ direction: "first" }}
                label="Put first"
                onError={setError}
              >
                <ChevronsUp className={cn("size-4", position === 1 && "opacity-30")} />
              </Control>
              <Control
                action={movePlanEntryAction}
                entryId={row.entryId}
                fields={{ direction: "up" }}
                label="Move up"
                onError={setError}
              >
                <ArrowUp className={cn("size-4", position === 1 && "opacity-30")} />
              </Control>
              <Control
                action={movePlanEntryAction}
                entryId={row.entryId}
                fields={{ direction: "down" }}
                label="Move down"
                onError={setError}
              >
                <ArrowDown className={cn("size-4", position === count && "opacity-30")} />
              </Control>
              <Control
                action={pushPlanEntryAction}
                entryId={row.entryId}
                fields={{ toDate: nextDay }}
                label={`Push to ${formatDate(nextDay)}`}
                onError={setError}
              >
                <span className="px-0.5 text-[12px]">next day →</span>
              </Control>
              <Control
                action={removePlanEntryAction}
                entryId={row.entryId}
                fields={{}}
                label="Take off the plan"
                onError={setError}
              >
                <X className="size-4" />
              </Control>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-overdue mt-1 pl-8 text-[12px]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
