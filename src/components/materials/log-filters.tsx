"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { MOVEMENT_KINDS } from "@/modules/materials/validation";

const fieldClass =
  "border-input bg-background h-9 rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * The log's filters, in the URL like every other register's (F22): a
 * filtered log is a link, and "what did the store enter last week" is
 * something an admin will want to send to somebody.
 *
 * The dates default to the last thirty days on the server, which is why
 * "Reset" is offered whenever anything is set — the empty URL is not "all
 * time", and the page says so.
 */
export function LogFilters({
  kind,
  from,
  to,
  query,
}: {
  kind: string;
  from: string;
  to: string;
  query: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(query);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(next.size > 0 ? `${pathname}?${next}` : pathname));
  };

  // Debounced, the same way the stock list's search box is.
  useEffect(() => {
    if (q === query) return;
    const timer = setTimeout(() => set("q", q), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query]);

  const anyFilter = Boolean(kind || from || to || query);

  return (
    <div className={cn("flex flex-wrap items-end gap-3", isPending && "opacity-70")}>
      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">Movement</span>
        <select
          value={kind}
          onChange={(e) => set("kind", e.target.value)}
          className={fieldClass}
          aria-label="Filter by movement"
        >
          <option value="">All</option>
          {MOVEMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => set("from", e.target.value)}
          className={fieldClass}
          aria-label="Movements dated on or after"
        />
      </label>

      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => set("to", e.target.value)}
          className={fieldClass}
          aria-label="Movements dated on or before"
        />
      </label>

      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">Material</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="SKU or name"
          className={cn(fieldClass, "w-48")}
          aria-label="Filter by material"
        />
      </label>

      {anyFilter ? (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace(pathname))}
          className="text-primary h-9 text-[13px] hover:underline"
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}
