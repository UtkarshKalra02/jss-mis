"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/utils";
import type { ClientOption } from "@/modules/designs/queries";
import type { GroupBy } from "@/modules/items/grouping";
import { NO_STAGE, type ItemSortKey } from "@/modules/items/queries";
import type { StageOption } from "@/modules/stage-update/precedence";

/**
 * The report builder, and none of it reaches the paper.
 *
 * Everything here is inside `print-hide`. What gets printed is the sheet
 * below; this is the panel that decides what the sheet contains.
 *
 * EVERY CONTROL WRITES TO THE URL rather than to component state (F22). A
 * report is then a link: the same three clients, the same two stages and the
 * same month can be bookmarked, sent to somebody, or reached again next
 * Monday, and the browser's back button undoes a filter instead of leaving the
 * page. It also means the server does the filtering, so the sheet cannot
 * disagree with the count in its own header.
 *
 * Ticking a box replaces the whole query string rather than patching one key,
 * which is what keeps `?clients=a,b` and `?clients=` (none ticked, meaning
 * "all") distinguishable from each other.
 */
export function ReportFilters({
  clients,
  stages,
  selectedClients,
  selectedStages,
  query,
  poDateFrom,
  poDateTo,
  groupBy,
  sort,
}: {
  clients: ClientOption[];
  stages: StageOption[];
  selectedClients: string[];
  selectedStages: string[];
  query: string;
  poDateFrom: string;
  poDateTo: string;
  groupBy: GroupBy;
  sort: ItemSortKey;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const push = (mutate: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(params.toString());
    mutate(q);
    startTransition(() => router.replace(q.size > 0 ? `${pathname}?${q}` : pathname));
  };

  const set = (key: string, value: string) =>
    push((q) => (value ? q.set(key, value) : q.delete(key)));

  const toggleIn = (key: string, value: string, current: string[]) =>
    push((q) => {
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (next.length > 0) q.set(key, next.join(","));
      else q.delete(key);
    });

  /** This calendar month, on the PO date — the commonest range by far. */
  const thisMonth = () => {
    const now = new Date();
    const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
    push((q) => {
      q.set("from", first.toISOString().slice(0, 10));
      q.set("to", last.toISOString().slice(0, 10));
    });
  };

  const lastMonth = () => {
    const now = new Date();
    const first = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    const last = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
    push((q) => {
      q.set("from", first.toISOString().slice(0, 10));
      q.set("to", last.toISOString().slice(0, 10));
    });
  };

  const anyFilter =
    selectedClients.length > 0 ||
    selectedStages.length > 0 ||
    Boolean(query || poDateFrom || poDateTo);

  return (
    <div
      className={cn(
        "print-hide mx-auto mb-5 max-w-[186mm] rounded-lg border border-neutral-300 bg-neutral-50 p-3",
        isPending && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/items" className="text-[13px] text-neutral-600 hover:underline">
          ← Item tracker
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="h-8 rounded-md bg-neutral-900 px-3 text-[13px] font-medium text-white hover:bg-neutral-700"
        >
          Print
        </button>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Panel title={`Clients${selectedClients.length ? ` (${selectedClients.length})` : ""}`}>
          {/* Nothing ticked means every client — stated, because an empty
              checklist otherwise reads as "nothing selected, nothing shown". */}
          <p className="mb-1 text-[11px] text-neutral-500">
            {selectedClients.length === 0 ? "All clients" : "Only those ticked"}
          </p>
          <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
            {clients.map((c) => (
              <Check
                key={c.id}
                checked={selectedClients.includes(c.id)}
                onChange={() => toggleIn("clients", c.id, selectedClients)}
                label={`${c.code} — ${c.name}`}
              />
            ))}
          </div>
        </Panel>

        <Panel title={`Stages${selectedStages.length ? ` (${selectedStages.length})` : ""}`}>
          <p className="mb-1 text-[11px] text-neutral-500">
            {selectedStages.length === 0 ? "All stages" : "Only those ticked"}
          </p>
          <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
            {/* A real state, and tickable like any stage — an item nobody has
                started is exactly what somebody filters for. */}
            <Check
              checked={selectedStages.includes(NO_STAGE)}
              onChange={() => toggleIn("stages", NO_STAGE, selectedStages)}
              label="Not started"
            />
            {stages.map((s) => (
              <Check
                key={s.code}
                checked={selectedStages.includes(s.code)}
                onChange={() => toggleIn("stages", s.code, selectedStages)}
                label={s.name}
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ordered from">
          <input
            type="date"
            value={poDateFrom}
            onChange={(e) => set("from", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Ordered to">
          <input
            type="date"
            value={poDateTo}
            onChange={(e) => set("to", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Group by">
          <select
            value={groupBy}
            onChange={(e) => set("group", e.target.value)}
            className={inputClass}
          >
            <option value="stage">Stage</option>
            <option value="client">Client</option>
            <option value="month">Month due</option>
          </select>
        </Field>

        <Field label="Sort within each block">
          <select
            value={sort}
            onChange={(e) => set("sort", e.target.value)}
            className={inputClass}
          >
            <option value="urgency">Most urgent first</option>
            <option value="itemCode">Item code</option>
            <option value="client">Client</option>
            <option value="pendingQty">Largest quantity first</option>
            <option value="stage">Stage order</option>
          </select>
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search item, client, PO or job card…"
          className={cn(inputClass, "min-w-56 flex-1")}
          aria-label="Search within the report"
        />
        <button type="button" onClick={thisMonth} className={chipClass}>
          This month
        </button>
        <button type="button" onClick={lastMonth} className={chipClass}>
          Last month
        </button>
        {anyFilter ? (
          <button
            type="button"
            onClick={() => push((q) => {
              for (const key of ["clients", "stages", "from", "to", "q"]) q.delete(key);
            })}
            className="text-[13px] text-neutral-600 hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

const inputClass =
  "h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-[13px] text-neutral-900";

const chipClass =
  "h-8 rounded-md border border-neutral-300 bg-white px-2.5 text-[13px] text-neutral-700 hover:bg-neutral-100";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-neutral-300 bg-white p-2">
      <p className="mb-1 text-[11px] font-medium tracking-wide text-neutral-500 uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium tracking-wide text-neutral-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-neutral-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-3.5 accent-neutral-900"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
