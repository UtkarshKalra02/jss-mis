"use client";

import { ChevronDown, ChevronRight, Layers, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { StagePill } from "@/components/stages/stage-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatDaysToCommitted, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { planCardsAction, type FormState } from "@/modules/planning/actions";
import type { PlanningRow } from "@/modules/planning/queries";
import {
  clientsOn,
  filterGroupsBy,
  groupByPressRun,
  rowsIn,
  selectableRows,
  stageSummary,
  type RunGroup,
} from "@/modules/stage-update/grouping";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background h-9 rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

function Submit({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** What the search box looks in: the Stage Update set plus the card number. */
function searchable(row: PlanningRow): (string | null)[] {
  return [
    row.jcNo,
    row.itemCode,
    row.itemName,
    row.clientCode,
    row.clientName,
    row.poInternalNo,
    row.currentStageName,
    row.machineName,
    row.runNo,
  ];
}

/**
 * The left panel of spec 6.6 — cards that need a day — with the tick list
 * that plans them (L1).
 *
 * THE PLATE GATE IS THE SAME ONE STAGE UPDATE HAS (H8). A ganged run is one
 * row; it carries no checkbox until it is opened, and opening it reveals whose
 * jobs are on it and a "select all N in this run" tick. Assigning a day to
 * several clients' jobs in one unexamined click has the same shape as
 * advancing their stages, and the run's own date moves with them only when
 * every one of them is ticked (L4).
 */
export function PlanningBoard({
  rows,
  runCardTotals,
  boardDate,
  canWrite,
}: {
  rows: PlanningRow[];
  /** Live cards per run, including ones not on this panel (H8). */
  runCardTotals: Record<string, number>;
  /** The day the right panel is showing — the default target for "Plan for". */
  boardDate: string;
  canWrite: boolean;
}) {
  const totals = useMemo(() => new Map(Object.entries(runCardTotals)), [runCardTotals]);
  const groups = useMemo(() => groupByPressRun(rows, totals), [rows, totals]);

  // Filtering in the browser, on Stage Update's reasoning: the whole dataset
  // is already here, and a re-query would remount the grid and lose the ticks.
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterGroupsBy(groups, query, searchable), [groups, query]);
  const shown = useMemo(() => rowsIn(visible), [visible]);

  const [state, formAction] = useActionState(planCardsAction, initialState);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(boardDate);

  // The right panel's day is the natural answer to "plan for when?", so a
  // change of day up top changes the default here too.
  useEffect(() => setTarget(boardDate), [boardDate]);

  // A successful save clears the ticks; the rows themselves leave the panel
  // when the page revalidates.
  useEffect(() => {
    if (state.ok) setSelected(new Set());
  }, [state]);

  // A row the search has hidden is dropped from the selection — a hidden tick
  // is a card nobody can see being planned.
  useEffect(() => {
    const onScreen = new Set(shown.map((r) => r.jobCardId));
    setSelected((current) => {
      const kept = new Set([...current].filter((id) => onScreen.has(id)));
      return kept.size === current.size ? current : kept;
    });
  }, [shown]);

  const toggleRun = (runId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        next.delete(runId);
        // Collapsing clears any ticks inside, or the next submit would carry
        // rows nobody can see (H8).
        setSelected((sel) => {
          const kept = new Set(sel);
          const group = groups.find((g) => g.kind === "run" && g.pressRunId === runId);
          if (group?.kind === "run") for (const r of group.rows) kept.delete(r.jobCardId);
          return kept;
        });
      } else next.add(runId);
      return next;
    });

  const setTicked = (ids: readonly string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const selectable = useMemo(
    () => selectableRows(visible, expanded).map((r) => r.jobCardId),
    [visible, expanded],
  );
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));

  const chosen = shown.filter((r) => selected.has(r.jobCardId));
  const clientsChosen = new Set(chosen.map((r) => r.clientCode)).size;

  return (
    <form action={formAction}>
      {chosen.map((r) => (
        <input key={r.jobCardId} type="hidden" name="jobCardId" value={r.jobCardId} />
      ))}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="relative w-full max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Card, item, client, PO, stage, machine, run…"
            className="pl-9"
            aria-label="Search the cards that need a day"
          />
        </div>

        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="plan-for" className="text-muted-foreground text-xs">
                Plan {selected.size > 0 ? `${selected.size} selected` : "selected"} for
              </label>
              <input
                id="plan-for"
                type="date"
                name="plannedDate"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={cn(inputClass, "w-44")}
                required
              />
            </div>
            <Submit
              label={`Plan ${selected.size || ""}`.trim()}
              disabled={selected.size === 0 || target === ""}
            />
          </div>
        ) : null}
      </div>

      {query.trim() ? (
        <p className="text-muted-foreground mt-1.5 text-xs" role="status">
          Showing {shown.length} of {rows.length} card{rows.length === 1 ? "" : "s"}.{" "}
          <button type="button" onClick={() => setQuery("")} className="text-primary hover:underline">
            Clear search
          </button>
        </p>
      ) : null}

      {/* Several clients in one plan is ordinary, and is stated so the
          person can see it — not coloured, because it is not a problem. */}
      {chosen.length > 1 && clientsChosen > 1 ? (
        <p className="text-muted-foreground mt-1.5 text-xs" role="status">
          {chosen.length} cards across {clientsChosen} clients.
        </p>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-overdue mt-2 text-sm">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time mt-2 text-sm">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              {canWrite ? (
                <th className="w-10 px-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => setTicked(selectable, e.target.checked)}
                    className="accent-primary size-4"
                    aria-label="Select every card that is currently shown"
                  />
                </th>
              ) : null}
              <th className="px-3">Card</th>
              <th className="px-3">Job</th>
              <th className="px-3">Client</th>
              <th className="px-3">Stage</th>
              <th className="px-3">Machine</th>
              <th className="px-3 text-right">Pending</th>
              <th className="px-3">Due</th>
              <th className="px-3">Was planned</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 9 : 8} className="text-muted-foreground px-3 py-8 text-center">
                  {query.trim()
                    ? `Nothing here matches “${query.trim()}”.`
                    : "Every open job card has a day. Release a card to plan more."}
                </td>
              </tr>
            ) : (
              visible.map((group) =>
                group.kind === "item" ? (
                  <CardRow
                    key={group.row.jobCardId}
                    row={group.row}
                    canWrite={canWrite}
                    ticked={selected.has(group.row.jobCardId)}
                    onTick={(on) => setTicked([group.row.jobCardId], on)}
                  />
                ) : (
                  <RunRows
                    key={group.pressRunId}
                    group={group}
                    canWrite={canWrite}
                    open={expanded.has(group.pressRunId)}
                    onToggle={() => toggleRun(group.pressRunId)}
                    selected={selected}
                    setTicked={setTicked}
                  />
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Section 6.6's colour code, as a left rule on the row and a tone on the due
 * cell. Semantic colour only: red is overdue, amber is inside the at-risk
 * window, green is a commitment with room, grey is no commitment at all (F8).
 */
function tone(row: Pick<PlanningRow, "isOverdue" | "isAtRisk" | "committedDate">) {
  if (row.isOverdue) return { rule: "border-l-overdue", text: "text-overdue font-medium" };
  if (row.isAtRisk) return { rule: "border-l-at-risk", text: "text-at-risk font-medium" };
  if (row.committedDate) return { rule: "border-l-on-time", text: "" };
  return { rule: "border-l-neutral-status", text: "text-muted-foreground" };
}

function DueCell({ row }: { row: PlanningRow }) {
  const { text } = tone(row);
  if (!row.committedDate) {
    return <span className="text-muted-foreground text-[12px]">No commitment</span>;
  }
  return (
    <span className="whitespace-nowrap">
      <span className="tabular-nums">{formatDate(row.committedDate)}</span>
      <span className={cn("ml-1.5 text-[12px]", text)}>
        {formatDaysToCommitted(row.daysToCommitted)}
      </span>
    </span>
  );
}

function JobCell({ row }: { row: PlanningRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{row.itemName}</p>
      <p className="text-muted-foreground text-[12px] tabular-nums">
        {row.itemCode} · {row.poInternalNo}
        {row.itemCount > 1
          ? ` · +${row.itemCount - 1} more item${row.itemCount === 2 ? "" : "s"}`
          : ""}
      </p>
    </div>
  );
}

function StageCell({ row }: { row: PlanningRow }) {
  if (row.stageCount > 1) {
    return (
      <span className="text-muted-foreground text-[13px]" title="The card's items are at different stages">
        Mixed — {row.stageCount} stages
      </span>
    );
  }
  return <StagePill name={row.currentStageName} colour={row.currentStageColour} />;
}

function CardRow({
  row,
  canWrite,
  ticked,
  onTick,
  inRun = false,
}: {
  row: PlanningRow;
  canWrite: boolean;
  ticked: boolean;
  onTick: (on: boolean) => void;
  inRun?: boolean;
}) {
  const { rule } = tone(row);
  return (
    <tr className={cn("border-l-2", rule, inRun && "bg-muted/20")}>
      {canWrite ? (
        <td className={cn("px-3", inRun && "pl-8")}>
          <input
            type="checkbox"
            checked={ticked}
            onChange={(e) => onTick(e.target.checked)}
            className="accent-primary size-4"
            aria-label={`Select ${row.jcNo}`}
          />
        </td>
      ) : null}
      <td className={cn("px-3 whitespace-nowrap tabular-nums", !canWrite && inRun && "pl-8")}>
        <Link href={`/job-cards/${row.jobCardId}`} className="text-primary hover:underline">
          {row.jcNo}
        </Link>
        {row.status !== "Planned" ? (
          <span className="text-muted-foreground ml-1.5 text-[11px]">{row.status}</span>
        ) : null}
      </td>
      <td className="max-w-72 px-3">
        <JobCell row={row} />
      </td>
      <td className="px-3">
        <span title={row.clientName}>{row.clientCode}</span>
        {row.clientCount > 1 ? (
          <span className="text-muted-foreground text-[12px]"> +{row.clientCount - 1}</span>
        ) : null}
      </td>
      <td className="px-3">
        <StageCell row={row} />
      </td>
      <td className="text-muted-foreground px-3">{row.machineName ?? "—"}</td>
      <td className="px-3 text-right tabular-nums">{formatQty(row.pendingQty)}</td>
      <td className="px-3">
        <DueCell row={row} />
      </td>
      <td className="px-3">
        {/* A slipped card says when it was meant to run. Amber, because a plan
            that did not happen is the thing the meeting is for. */}
        {row.plannedDate ? (
          <span className="text-at-risk text-[12px] whitespace-nowrap tabular-nums">
            {formatDate(row.plannedDate)} · slipped
          </span>
        ) : (
          <span className="text-muted-foreground text-[12px]">—</span>
        )}
      </td>
    </tr>
  );
}

function runSummaryLine(group: RunGroup<PlanningRow>): string {
  const shown = group.rows.length;
  const clients = clientsOn(group.rows).length;
  const jobs =
    group.totalCards !== null && group.totalCards > shown
      ? `${shown} of ${group.totalCards} jobs shown`
      : `${shown} job${shown === 1 ? "" : "s"}`;
  return `${jobs} · ${clients} client${clients === 1 ? "" : "s"}`;
}

function RunRows({
  group,
  canWrite,
  open,
  onToggle,
  selected,
  setTicked,
}: {
  group: RunGroup<PlanningRow>;
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
  selected: ReadonlySet<string>;
  setTicked: (ids: readonly string[], on: boolean) => void;
}) {
  const memberIds = group.rows.map((r) => r.jobCardId);
  const allInRun = memberIds.every((id) => selected.has(id));
  const summary = stageSummary(group.rows);
  const pending = group.rows.reduce((n, r) => n + r.pendingQty, 0);

  return (
    <Fragment>
      {/* THE COLLAPSED PLATE: no checkbox while shut (H8). */}
      <tr className="bg-muted/30">
        {canWrite ? (
          <td className="px-3">
            {open ? (
              <input
                type="checkbox"
                checked={allInRun}
                onChange={(e) => setTicked(memberIds, e.target.checked)}
                className="accent-primary size-4"
                aria-label={`Select all ${group.rows.length} jobs on run ${group.runNo}`}
              />
            ) : null}
          </td>
        ) : null}
        <td colSpan={3} className="px-3 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-2 text-left"
          >
            {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
            <Layers className="text-muted-foreground size-4 shrink-0" />
            <span className="font-medium tabular-nums">{group.runNo}</span>
            <span className="text-muted-foreground">
              {group.machine ?? "Machine not recorded"}
              {group.runDate ? ` · run dated ${formatDate(group.runDate)}` : ""}
            </span>
            <span className="text-muted-foreground/80 text-[12px]">{runSummaryLine(group)}</span>
          </button>
        </td>
        <td className="px-3">
          {summary.kind === "single" ? (
            <StagePill name={summary.name} colour={summary.colour} />
          ) : summary.kind === "mixed" ? (
            <span className="text-muted-foreground text-[13px]">Mixed — {summary.distinct} stages</span>
          ) : (
            <span className="text-muted-foreground text-[13px]">—</span>
          )}
        </td>
        <td className="px-3" />
        <td className="px-3 text-right tabular-nums">{formatQty(pending)}</td>
        <td colSpan={2} className="px-3">
          {canWrite && !open ? (
            <button type="button" onClick={onToggle} className="text-primary text-[13px] hover:underline">
              Open to plan
            </button>
          ) : null}
        </td>
      </tr>

      {open
        ? group.rows.map((row) => (
            <CardRow
              key={row.jobCardId}
              row={row}
              canWrite={canWrite}
              ticked={selected.has(row.jobCardId)}
              onTick={(on) => setTicked([row.jobCardId], on)}
              inRun
            />
          ))
        : null}
    </Fragment>
  );
}
