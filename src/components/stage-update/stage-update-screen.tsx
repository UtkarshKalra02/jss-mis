"use client";

import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { StagePill } from "@/components/stages/stage-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCommittedDate, formatDaysToCommitted, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateStageAction, type FormState } from "@/modules/stage-update/actions";
import {
  clientsOn,
  groupByPressRun,
  selectableIds,
  stageSummary,
  type RunGroup,
  type StageUpdateGroup,
} from "@/modules/stage-update/grouping";
import { isBackwardMove, type StageOption } from "@/modules/stage-update/precedence";
import type { StageUpdateRow } from "@/modules/stage-update/queries";

import { StagePicker } from "./stage-picker";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

function Submit({ label, size }: { label: string; size?: "sm" | "lg" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Spec 6.7 — Stage Update, in both of its shapes.
 *
 * PLANNER on a laptop gets the dense grid with bulk select. FLOOR on a phone
 * gets a card list with large tap targets, "a single stage dropdown, nothing
 * else" — no remarks, no event time, no bulk selection, because Ajay is
 * standing next to a machine holding a phone in one hand.
 *
 * Both are rendered and CSS decides which is visible, rather than measuring the
 * viewport in JavaScript. Server-rendered markup that does not depend on a
 * measurement cannot flash the wrong layout before hydrating.
 */
export function StageUpdateScreen({
  rows,
  stages,
  runCardCounts,
}: {
  rows: StageUpdateRow[];
  stages: StageOption[];
  /** Live job cards per run, including ones already delivered (H8). */
  runCardCounts: Record<string, number>;
}) {
  const totals = useMemo(
    () => new Map(Object.entries(runCardCounts)),
    [runCardCounts],
  );
  const groups = useMemo(() => groupByPressRun(rows, totals), [rows, totals]);

  return (
    <>
      <div className="hidden md:block">
        <DesktopGrid rows={rows} groups={groups} stages={stages} />
      </div>
      <div className="md:hidden">
        <MobileCards groups={groups} stages={stages} />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared run furniture                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a collapsed plate says about itself.
 *
 * "3 jobs · 2 clients" and, where some of the plate has already been
 * delivered, "2 of 3 jobs shown". A header claiming three jobs above two
 * visible rows is a worse lie than no number at all, since Stage Update only
 * ever lists open work.
 */
function runSummaryLine(group: RunGroup): string {
  const shown = group.rows.length;
  const clients = clientsOn(group.rows).length;

  const jobs =
    group.totalCards !== null && group.totalCards > shown
      ? `${shown} of ${group.totalCards} jobs shown`
      : `${shown} job${shown === 1 ? "" : "s"}`;

  // Several clients on one plate is the entire reason the plate exists (H3).
  // It is stated as information and is never coloured as a problem.
  return `${jobs} · ${clients} client${clients === 1 ? "" : "s"}`;
}

/** The stage pill, or an honest refusal to reduce several stages to one. */
function RunStage({ group }: { group: RunGroup }) {
  const summary = stageSummary(group.rows);

  if (summary.kind === "single") {
    return <StagePill name={summary.name} colour={summary.colour} />;
  }

  if (summary.kind === "mixed") {
    return (
      <span className="text-muted-foreground text-[13px]">
        Mixed — {summary.distinct} stages
      </span>
    );
  }

  return <span className="text-muted-foreground text-[13px]">—</span>;
}

/* -------------------------------------------------------------------------- */
/* Desktop                                                                     */
/* -------------------------------------------------------------------------- */

function DesktopGrid({
  rows,
  groups,
  stages,
}: {
  rows: StageUpdateRow[];
  groups: StageUpdateGroup[];
  stages: StageOption[];
}) {
  const [state, formAction] = useActionState(updateStageAction, initialState);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stageCode, setStageCode] = useState("");
  const [remarks, setRemarks] = useState("");
  const [eventAt, setEventAt] = useState("");
  const [confirming, setConfirming] = useState(false);

  /**
   * Which plates are open. THE EXPANSION GATE (H8) lives here: a collapsed run
   * offers no checkbox and no stage picker, so its jobs cannot be advanced
   * without somebody opening it and seeing whose they are.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleRun = (runId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        next.delete(runId);
        // Collapsing must not leave hidden rows ticked — the next bulk update
        // would carry items nobody can see.
        setSelected((sel) => {
          const kept = new Set(sel);
          const group = groups.find((g) => g.kind === "run" && g.pressRunId === runId);
          if (group?.kind === "run") for (const r of group.rows) kept.delete(r.poItemId);
          return kept;
        });
      } else next.add(runId);
      return next;
    });

  // A successful save clears the selection, or the next bulk update silently
  // includes rows somebody already moved.
  useEffect(() => {
    if (state.ok) {
      setSelected(new Set());
      setStageCode("");
      setRemarks("");
    }
  }, [state]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.poItemId, r])), [rows]);
  const chosen = [...selected].map((id) => byId.get(id)).filter(Boolean) as StageUpdateRow[];

  const target = stages.find((s) => s.code === stageCode);

  // Which of the selected rows would be going backwards (F4).
  const backwards = target
    ? chosen.filter((r) => isBackwardMove(r.currentStageSequence, target.sequence))
    : [];

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /*
   * Select-all covers what is actually visible and tickable, not every row on
   * the screen. Sweeping up the members of a collapsed plate is exactly the
   * accident this design exists to prevent.
   */
  const selectable = useMemo(() => selectableIds(groups, expanded), [groups, expanded]);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));

  const clientsInSelection = new Set(chosen.map((r) => r.clientCode));

  /**
   * The bulk selection is not driven by the picker's own job type, because a
   * mixed selection has no single one. It offers every stage in sequence
   * order — the per-row picker is where F4's precedence guides the choice.
   */
  return (
    <form action={formAction}>
      {chosen.map((r) => (
        <input key={r.poItemId} type="hidden" name="poItemId" value={r.poItemId} />
      ))}
      <input type="hidden" name="stageCode" value={stageCode} />
      <input type="hidden" name="remarks" value={remarks} />
      <input type="hidden" name="eventAt" value={eventAt} />

      <div className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="space-y-1">
          <label htmlFor="bulk-stage" className="text-muted-foreground text-xs">
            Move {selected.size > 0 ? `${selected.size} selected` : "selected"} to
          </label>
          <select
            id="bulk-stage"
            value={stageCode}
            onChange={(e) => setStageCode(e.target.value)}
            disabled={selected.size === 0}
            className={cn(inputClass, "w-56")}
          >
            <option value="">Choose a stage…</option>
            {stages.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
                {s.isOptional ? " (optional)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="bulk-when" className="text-muted-foreground text-xs">
            When it happened
          </label>
          <input
            id="bulk-when"
            type="datetime-local"
            value={eventAt}
            onChange={(e) => setEventAt(e.target.value)}
            className={cn(inputClass, "w-52")}
          />
        </div>

        <div className="min-w-48 grow space-y-1">
          <label htmlFor="bulk-remarks" className="text-muted-foreground text-xs">
            Remarks
          </label>
          <input
            id="bulk-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* A backward move is confirmed, never blocked (F4). */}
        {backwards.length > 0 ? (
          <Button
            type="button"
            disabled={selected.size === 0 || !stageCode}
            onClick={() => setConfirming(true)}
          >
            Update {selected.size}
          </Button>
        ) : (
          <div className={selected.size === 0 || !stageCode ? "pointer-events-none opacity-50" : ""}>
            <Submit label={`Update ${selected.size || ""}`.trim()} />
          </div>
        )}
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        Leave the time blank for now. Stage events record when work HAPPENED, not when it
        was typed — set it back if you are catching up on yesterday.
      </p>

      {state.error ? (
        <p role="alert" className="text-overdue mt-3 text-sm">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time mt-3 text-sm">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="w-10 px-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable) : new Set())}
                  className="accent-primary size-4"
                  aria-label="Select every item that is currently shown"
                />
              </th>
              <th className="px-3">Item</th>
              <th className="px-3">Name</th>
              <th className="px-3">Client</th>
              <th className="px-3 text-right">Pending</th>
              <th className="px-3">Current stage</th>
              <th className="px-3">Committed</th>
              <th className="min-w-52 px-3">Move to</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-3 py-8 text-center">
                  Nothing open. Every item has been delivered or closed.
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                if (group.kind === "item") {
                  return (
                    <ItemRow
                      key={group.row.poItemId}
                      row={group.row}
                      stages={stages}
                      selected={selected}
                      toggle={toggle}
                      stageCode={stageCode}
                      onPick={(code) => {
                        setSelected(new Set([group.row.poItemId]));
                        setStageCode(code);
                      }}
                    />
                  );
                }

                const open = expanded.has(group.pressRunId);
                const memberIds = group.rows.map((r) => r.poItemId);
                const allInRun = memberIds.every((id) => selected.has(id));

                return (
                  <Fragment key={group.pressRunId}>
                    {/* THE COLLAPSED PLATE. No checkbox and no picker while it
                        is shut: one click here would advance several clients'
                        items, each with its own committed date feeding its own
                        OTD, and stage_event is append-only so there is no undo
                        (H8). */}
                    <tr className="bg-muted/30">
                      <td className="px-3">
                        {open ? (
                          <input
                            type="checkbox"
                            checked={allInRun}
                            onChange={(e) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                for (const id of memberIds) {
                                  if (e.target.checked) next.add(id);
                                  else next.delete(id);
                                }
                                return next;
                              })
                            }
                            className="accent-primary size-4"
                            aria-label={`Select all ${group.rows.length} jobs on run ${group.runNo}`}
                          />
                        ) : null}
                      </td>

                      <td colSpan={4} className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleRun(group.pressRunId)}
                          aria-expanded={open}
                          className="flex items-center gap-2 text-left"
                        >
                          {open ? (
                            <ChevronDown className="size-4 shrink-0" />
                          ) : (
                            <ChevronRight className="size-4 shrink-0" />
                          )}
                          <Layers className="text-muted-foreground size-4 shrink-0" />
                          <span className="font-medium tabular-nums">{group.runNo}</span>
                          <span className="text-muted-foreground">
                            {group.machine ?? "Machine not recorded"}
                            {group.runDate ? ` · ${formatCommittedDate(group.runDate)}` : ""}
                          </span>
                          <span className="text-muted-foreground/80 text-[12px]">
                            {runSummaryLine(group)}
                          </span>
                        </button>
                      </td>

                      <td className="px-3">
                        <RunStage group={group} />
                      </td>

                      <td className="px-3" />

                      <td className="px-3">
                        {open ? (
                          <span className="text-muted-foreground text-[12px]">
                            Move each job below
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleRun(group.pressRunId)}
                            className="text-primary text-[13px] hover:underline"
                          >
                            Open to update
                          </button>
                        )}
                      </td>
                    </tr>

                    {open
                      ? group.rows.map((row) => (
                          <ItemRow
                            key={row.poItemId}
                            row={row}
                            stages={stages}
                            selected={selected}
                            toggle={toggle}
                            stageCode={stageCode}
                            inRun
                            onPick={(code) => {
                              setSelected(new Set([row.poItemId]));
                              setStageCode(code);
                            }}
                          />
                        ))
                      : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <BackwardConfirm
        open={confirming}
        onOpenChange={setConfirming}
        rows={backwards}
        targetName={target?.name ?? ""}
        clients={[...clientsInSelection]}
      />
    </form>
  );
}

/**
 * One item's row, used both on its own and as a member of an expanded plate.
 *
 * `inRun` indents it and nothing else. The controls are identical either way,
 * deliberately: once a plate is open its jobs are ordinary rows again, and a
 * ganged item that behaved differently from a standalone one would be a second set
 * of rules to learn for three to eight jobs a month.
 */
function ItemRow({
  row,
  stages,
  selected,
  toggle,
  stageCode,
  onPick,
  inRun,
}: {
  row: StageUpdateRow;
  stages: StageOption[];
  selected: Set<string>;
  toggle: (id: string) => void;
  stageCode: string;
  onPick: (code: string) => void;
  inRun?: boolean;
}) {
  return (
    <tr className={cn(selected.has(row.poItemId) && "bg-muted/50")}>
      <td className={cn("px-3", inRun && "pl-8")}>
        <input
          type="checkbox"
          checked={selected.has(row.poItemId)}
          onChange={() => toggle(row.poItemId)}
          className="accent-primary size-4"
          aria-label={`Select ${row.itemCode}`}
        />
      </td>
      <td className="px-3 tabular-nums">{row.itemCode}</td>
      <td className="px-3">{row.itemName}</td>
      <td className="px-3" title={row.clientName}>
        {row.clientCode}
      </td>
      <td className="px-3 text-right tabular-nums">{formatQty(row.pendingQty)}</td>
      <td className="px-3">
        <StagePill name={row.currentStageName} colour={row.currentStageColour} />
      </td>
      <td
        className={cn(
          "px-3",
          row.isOverdue && "text-overdue",
          row.isAtRisk && "text-at-risk",
          !row.committedDate && "text-muted-foreground text-[11px]",
        )}
      >
        {formatCommittedDate(row.committedDate)}
        {row.committedDate ? (
          <span className="ml-2 text-[11px] opacity-80">
            {formatDaysToCommitted(row.daysToCommitted)}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-1">
        {/* Per row, F4's precedence guides what is offered first. */}
        <StagePicker
          stages={stages}
          jobType={row.jobType}
          routeCodes={row.routeCodes}
          value={selected.has(row.poItemId) ? stageCode : ""}
          onChange={onPick}
          className={inputClass}
          ariaLabel={`Move ${row.itemCode} to`}
        />
      </td>
    </tr>
  );
}

/**
 * The confirmation for a backward move.
 *
 * Not a block. Rework is real on a shop floor (F4), and a system that cannot
 * express it gets worked around — but moving a job backwards is usually a
 * mis-click, so it is worth one question that names the items.
 *
 * The confirm button is a plain submit inside the same form, so the click that
 * confirms is the click that submits. Setting a flag and submitting separately
 * would send the previous render's values.
 */
function BackwardConfirm({
  open,
  onOpenChange,
  rows,
  targetName,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: StageUpdateRow[];
  targetName: string;
  /** Every client in the selection, so a cross-client move says so (H8). */
  clients: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move backwards to {targetName}?</DialogTitle>
          <DialogDescription>
            {rows.length === 1
              ? "This item is further along than that."
              : `${rows.length} of the selected items are further along than that.`}{" "}
            That is allowed — rework happens — and it is recorded as a new event rather than
            undoing the old one.
          </DialogDescription>
        </DialogHeader>

        {/* Naming the clients is the point when the selection came off a
            ganged plate. Each of these items has its own committed date and
            its own OTD, and a move that spans several of them is worth reading
            twice — a stage event cannot be taken back (C6). */}
        {clients.length > 1 ? (
          <p className="text-at-risk text-[13px]">
            This spans {clients.length} clients — {clients.join(", ")}.
          </p>
        ) : null}

        <ul className="max-h-56 space-y-1 overflow-y-auto text-[13px]">
          {rows.map((r) => (
            <li key={r.poItemId} className="flex items-center gap-2">
              <span className="tabular-nums">{r.itemCode}</span>
              <span className="text-muted-foreground truncate">{r.itemName}</span>
              <StagePill name={r.currentStageName} colour={r.currentStageColour} />
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Submit label="Move backwards" size="sm" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ajay's screen. Spec 6.7: "card list, large tap targets, single stage
 * dropdown, nothing else."
 *
 * Taken literally, and the omissions are the design. No bulk select, no
 * remarks, no event time — he is updating what just happened, standing next to
 * a machine, holding a phone in one hand. Every field that is not the stage is
 * a field he has to get past.
 */
/**
 * Ajay's screen. Spec 6.7: "card list, large tap targets, single stage
 * dropdown, nothing else."
 *
 * Taken literally, and the omissions are the design. No bulk select, no
 * remarks, no event time — he is updating what just happened, standing next to
 * a machine, holding a phone in one hand. Every field that is not the stage is
 * a field he has to get past.
 *
 * A ganged plate collapses here too (H8), and expanding it reveals exactly the
 * cards he would otherwise have scrolled past separately. Nothing is lost by
 * the gate: there has never been a bulk control on this view to gate.
 */
function MobileCards({
  groups,
  stages,
}: {
  groups: StageUpdateGroup[];
  stages: StageOption[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        Nothing open.
      </p>
    );
  }

  const toggleRun = (runId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });

  return (
    <ul className="space-y-3">
      {groups.map((group) => {
        if (group.kind === "item") {
          return <MobileCard key={group.row.poItemId} row={group.row} stages={stages} />;
        }

        const open = expanded.has(group.pressRunId);

        return (
          <li key={group.pressRunId} className="bg-muted/30 rounded-lg border p-3">
            {/* Ajay's view of a shared plate. No stage control on the collapsed
                card — his screen has never had a bulk control (F27) and the
                one thing that must not be possible from a phone in one hand is
                advancing three clients' jobs with a single tap (H8). */}
            <button
              type="button"
              onClick={() => toggleRun(group.pressRunId)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 text-left"
            >
              {open ? (
                <ChevronDown className="size-5 shrink-0" />
              ) : (
                <ChevronRight className="size-5 shrink-0" />
              )}
              <Layers className="text-muted-foreground size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium tabular-nums">{group.runNo}</span>
                <span className="text-muted-foreground block text-[13px]">
                  {group.machine ?? "Machine not recorded"} · {runSummaryLine(group)}
                </span>
              </span>
              <RunStage group={group} />
            </button>

            {open ? (
              <ul className="mt-3 space-y-3">
                {group.rows.map((row) => (
                  <MobileCard key={row.poItemId} row={row} stages={stages} />
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MobileCard({ row, stages }: { row: StageUpdateRow; stages: StageOption[] }) {
  const [state, formAction] = useActionState(updateStageAction, initialState);
  const [stageCode, setStageCode] = useState("");

  useEffect(() => {
    if (state.ok) setStageCode("");
  }, [state]);

  return (
    <li className="rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium tabular-nums">{row.itemCode}</span>
        <span className="text-muted-foreground text-[13px]">{row.clientCode}</span>
      </div>

      <p className="mt-0.5 text-[15px]">{row.itemName}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StagePill name={row.currentStageName} colour={row.currentStageColour} />
        <span
          className={cn(
            "text-[13px]",
            row.isOverdue && "text-overdue",
            row.isAtRisk && "text-at-risk",
            !row.committedDate && "text-muted-foreground",
          )}
        >
          {row.committedDate ? formatDaysToCommitted(row.daysToCommitted) : "no commitment"}
        </span>
        <span className="text-muted-foreground text-[13px] tabular-nums">
          {formatQty(row.pendingQty)} pending
        </span>
      </div>

      <form action={formAction} className="mt-3 flex gap-2">
        <input type="hidden" name="poItemId" value={row.poItemId} />

        <StagePicker
          stages={stages}
          jobType={row.jobType}
          routeCodes={row.routeCodes}
          value={stageCode}
          onChange={setStageCode}
          name="stageCode"
          required
          // 44px tall: a real tap target, not a desktop control on a phone.
          className="border-input bg-background h-11 grow rounded-md border px-3 text-[15px]"
          ariaLabel={`Move ${row.itemCode} to`}
        />

        <Button type="submit" size="lg" className="h-11 shrink-0" disabled={!stageCode}>
          Update
        </Button>
      </form>

      {state.error ? (
        <p role="alert" className="text-overdue mt-2 text-[13px]">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time mt-2 text-[13px]">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
