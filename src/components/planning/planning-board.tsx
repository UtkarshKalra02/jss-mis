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
import { addToPlanAction, type FormState } from "@/modules/planning/actions";
import type { PlanItemRow } from "@/modules/planning/queries";
import {
  clientsOn,
  filterGroupsBy,
  groupByPressRun,
  rowsIn,
  selectableRows,
  stageSummary,
  type RunGroup,
} from "@/modules/stage-update/grouping";
import type { StageOption } from "@/modules/stage-update/precedence";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background h-9 rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

export type MachineChoice = { id: string; name: string };

function Submit({
  label,
  kind,
  disabled,
  variant,
}: {
  label: string;
  kind: "Production" | "Dispatch";
  disabled: boolean;
  variant?: "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="kind" value={kind} variant={variant} disabled={disabled || pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** What the search box looks in: the Stage Update set plus the card number. */
function searchable(row: PlanItemRow): (string | null)[] {
  return [
    row.itemCode,
    row.itemName,
    row.clientCode,
    row.clientName,
    row.poInternalNo,
    row.currentStageName,
    row.jcNo,
    row.machineName,
    row.runNo,
  ];
}

/** "Tue 16 Sep" for the planned-on chips. */
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
 * The left panel of spec 6.6 — every open item, most urgent first — with the
 * tick list that puts items on a day (M1).
 *
 * Two buttons, one form: "Add to production" needs a station (M2) and takes
 * the optional press; "Add to dispatch" needs nothing and defaults each line
 * to the pending quantity (M3). The kind rides on the button that was
 * pressed, so no state flag arrives a render late (F20).
 *
 * THE PLATE GATE IS THE SAME ONE STAGE UPDATE HAS (H8). Items whose cards
 * share a press run are one row until opened.
 */
export function PlanningBoard({
  rows,
  stages,
  machines,
  runCardTotals,
  boardDate,
  canWrite,
}: {
  rows: PlanItemRow[];
  stages: StageOption[];
  machines: MachineChoice[];
  /** Live cards per run, including ones not on this panel (H8). */
  runCardTotals: Record<string, number>;
  /** The day the right panel is showing — the default target. */
  boardDate: string;
  canWrite: boolean;
}) {
  const totals = useMemo(() => new Map(Object.entries(runCardTotals)), [runCardTotals]);
  const groups = useMemo(() => groupByPressRun(rows, totals), [rows, totals]);

  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterGroupsBy(groups, query, searchable), [groups, query]);
  const shown = useMemo(() => rowsIn(visible), [visible]);

  const [state, formAction] = useActionState(addToPlanAction, initialState);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(boardDate);
  const [stageCode, setStageCode] = useState("");
  const [stageTouched, setStageTouched] = useState(false);
  const [machineId, setMachineId] = useState("");

  useEffect(() => setTarget(boardDate), [boardDate]);

  useEffect(() => {
    if (state.ok) setSelected(new Set());
  }, [state]);

  // A row the search has hidden is dropped from the selection.
  useEffect(() => {
    const onScreen = new Set(shown.map((r) => r.poItemId));
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
        setSelected((sel) => {
          const kept = new Set(sel);
          const group = groups.find((g) => g.kind === "run" && g.pressRunId === runId);
          if (group?.kind === "run") for (const r of group.rows) kept.delete(r.poItemId);
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
    () => selectableRows(visible, expanded).map((r) => r.poItemId),
    [visible, expanded],
  );
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));

  const chosen = shown.filter((r) => selected.has(r.poItemId));
  const clientsChosen = new Set(chosen.map((r) => r.clientCode)).size;

  /*
   * The station defaults to where the ticked items are, when they agree, and
   * is otherwise left for the person to choose. Once they have chosen, their
   * choice stands whatever else they tick.
   */
  const commonStage = useMemo(() => {
    const codes = new Set(chosen.map((r) => r.currentStage).filter(Boolean));
    return codes.size === 1 ? ([...codes][0] as string) : "";
  }, [chosen]);
  const effectiveStage = stageTouched ? stageCode : commonStage;

  return (
    <form action={formAction}>
      {chosen.map((r) => (
        <input key={r.poItemId} type="hidden" name="poItemId" value={r.poItemId} />
      ))}

      <div className="relative max-w-md">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Item, client, PO, stage, card, machine, run…"
          className="pl-9"
          aria-label="Search the open items"
        />
      </div>
      {query.trim() ? (
        <p className="text-muted-foreground mt-1.5 text-xs" role="status">
          Showing {shown.length} of {rows.length} item{rows.length === 1 ? "" : "s"}.{" "}
          <button type="button" onClick={() => setQuery("")} className="text-primary hover:underline">
            Clear search
          </button>
        </p>
      ) : null}

      {canWrite ? (
        <div className="bg-muted/40 mt-3 flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="space-y-1">
            <label htmlFor="plan-date" className="text-muted-foreground text-xs">
              Day
            </label>
            <input
              id="plan-date"
              type="date"
              name="planDate"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={cn(inputClass, "w-40")}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="plan-stage" className="text-muted-foreground text-xs">
              Station
            </label>
            <select
              id="plan-stage"
              name="stageCode"
              value={effectiveStage}
              onChange={(e) => {
                setStageTouched(true);
                setStageCode(e.target.value);
              }}
              className={cn(inputClass, "w-48")}
            >
              <option value="">Choose a station…</option>
              {stages.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="plan-machine" className="text-muted-foreground text-xs">
              Machine
            </label>
            <select
              id="plan-machine"
              name="machineId"
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className={cn(inputClass, "w-44")}
            >
              <option value="">—</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <Submit
              label={`Add ${selected.size || ""} to production`.replace("  ", " ")}
              kind="Production"
              disabled={selected.size === 0 || target === "" || effectiveStage === ""}
            />
            <Submit
              label={`Add ${selected.size || ""} to dispatch`.replace("  ", " ")}
              kind="Dispatch"
              variant="outline"
              disabled={selected.size === 0 || target === ""}
            />
          </div>

          <div className="basis-full">
            {chosen.length > 0 && effectiveStage === "" ? (
              <p className="text-muted-foreground text-xs" role="status">
                Choose the station these {chosen.length === 1 ? "goes" : "go"} to, or add
                {chosen.length === 1 ? " it" : " them"} to the dispatch list.
              </p>
            ) : null}
            {chosen.length > 1 && clientsChosen > 1 ? (
              <p className="text-muted-foreground text-xs" role="status">
                {chosen.length} items across {clientsChosen} clients.
              </p>
            ) : null}
            {state.error ? (
              <p role="alert" className="text-overdue text-sm">
                {state.error}
              </p>
            ) : null}
            {state.ok && state.message ? (
              <p role="status" className="text-on-time text-sm">
                {state.message}
              </p>
            ) : null}
          </div>
        </div>
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
                    aria-label="Select every item that is currently shown"
                  />
                </th>
              ) : null}
              <th className="px-3">Item</th>
              <th className="px-3">Client</th>
              <th className="px-3">Stage now</th>
              <th className="px-3 text-right">Pending</th>
              <th className="px-3">Due</th>
              <th className="px-3">Planned on</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 7 : 6} className="text-muted-foreground px-3 py-8 text-center">
                  {query.trim()
                    ? `Nothing here matches “${query.trim()}”.`
                    : "Nothing open. Every item has been delivered or closed."}
                </td>
              </tr>
            ) : (
              visible.map((group) =>
                group.kind === "item" ? (
                  <ItemRow
                    key={group.row.poItemId}
                    row={group.row}
                    canWrite={canWrite}
                    ticked={selected.has(group.row.poItemId)}
                    onTick={(on) => setTicked([group.row.poItemId], on)}
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
 * cell. Semantic colour only: red overdue, amber inside the at-risk window,
 * green a commitment with room, grey no commitment at all (F8).
 */
function tone(row: Pick<PlanItemRow, "isOverdue" | "isAtRisk" | "committedDate">) {
  if (row.isOverdue) return { rule: "border-l-overdue", text: "text-overdue font-medium" };
  if (row.isAtRisk) return { rule: "border-l-at-risk", text: "text-at-risk font-medium" };
  if (row.committedDate) return { rule: "border-l-on-time", text: "" };
  return { rule: "border-l-neutral-status", text: "text-muted-foreground" };
}

function DueCell({ row }: { row: PlanItemRow }) {
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

function PlannedOn({ row }: { row: PlanItemRow }) {
  if (row.productionDates.length === 0 && row.dispatchDates.length === 0) {
    return <span className="text-muted-foreground text-[12px]">—</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {row.productionDates.map((d) => (
        <Link
          key={`p${d}`}
          href={`/planning?date=${d}`}
          className="bg-muted rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap hover:underline"
        >
          {shortDay(d)}
        </Link>
      ))}
      {row.dispatchDates.map((d) => (
        <Link
          key={`d${d}`}
          href={`/planning?date=${d}`}
          className="bg-muted rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap hover:underline"
          title="On the dispatch list"
        >
          ↗ {shortDay(d)}
        </Link>
      ))}
    </span>
  );
}

function ItemRow({
  row,
  canWrite,
  ticked,
  onTick,
  inRun = false,
}: {
  row: PlanItemRow;
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
            aria-label={`Select ${row.itemCode}`}
          />
        </td>
      ) : null}
      <td className={cn("max-w-80 px-3", !canWrite && inRun && "pl-8")}>
        <p className="truncate font-medium">
          <Link href={`/items/${row.poItemId}`} className="hover:underline">
            {row.itemName}
          </Link>
        </p>
        <p className="text-muted-foreground text-[12px] tabular-nums">
          {row.itemCode} · {row.poInternalNo}
          {row.jcNo ? (
            <>
              {" · "}
              <Link href={`/job-cards/${row.jobCardId}`} className="text-primary hover:underline">
                {row.jcNo}
              </Link>
              {row.machineName ? ` · ${row.machineName}` : ""}
            </>
          ) : (
            <span className="text-muted-foreground/70"> · no card yet</span>
          )}
        </p>
      </td>
      <td className="px-3">
        <span title={row.clientName}>{row.clientCode}</span>
      </td>
      <td className="px-3">
        <StagePill name={row.currentStageName} colour={row.currentStageColour} />
      </td>
      <td className="px-3 text-right tabular-nums">{formatQty(row.pendingQty)}</td>
      <td className="px-3">
        <DueCell row={row} />
      </td>
      <td className="px-3">
        <PlannedOn row={row} />
      </td>
    </tr>
  );
}

function runSummaryLine(group: RunGroup<PlanItemRow>): string {
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
  group: RunGroup<PlanItemRow>;
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
  selected: ReadonlySet<string>;
  setTicked: (ids: readonly string[], on: boolean) => void;
}) {
  const memberIds = group.rows.map((r) => r.poItemId);
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
        <td colSpan={2} className="px-3 py-2">
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
            <ItemRow
              key={row.poItemId}
              row={row}
              canWrite={canWrite}
              ticked={selected.has(row.poItemId)}
              onTick={(on) => setTicked([row.poItemId], on)}
              inRun
            />
          ))
        : null}
    </Fragment>
  );
}
