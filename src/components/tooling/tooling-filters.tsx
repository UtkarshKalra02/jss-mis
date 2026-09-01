"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  TOOL_TYPE_LABELS,
  toolConditions,
  toolStatuses,
  toolTypes,
} from "@/modules/tooling/validation";

/**
 * Search and filters for the register, both held in the URL.
 *
 * Same reasoning as the Item Tracker (F22): a search is a link. Punit can send
 * Ajay the exact filtered screen, the back button behaves, and the matching
 * rules stay in one SQL statement instead of being half-reimplemented here.
 *
 * The search is debounced at 250ms and the filters are not — a filter is one
 * deliberate click, where typing "fertilina" is eight keystrokes and should be
 * one query.
 */
export function ToolingSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [value, setValue] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (value === initialQuery) return;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      startTransition(() => router.replace(`${pathname}?${next}`));
    }, 250);

    return () => clearTimeout(timer);
  }, [value, initialQuery, params, pathname, router]);

  return (
    <div className="relative w-full max-w-lg">
      <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Tool no, name, location, client or design"
        aria-label="Search the tooling register"
        className={cn("pl-9", isPending && "opacity-70")}
      />
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="text-[12px]">
      <span className="text-muted-foreground block">{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          router.replace(next.size > 0 ? `${pathname}?${next}` : pathname);
        }}
        className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ToolingFilters({
  toolType,
  condition,
  status,
}: {
  toolType: string;
  condition: string;
  status: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <FilterSelect
        name="type"
        label="Type"
        value={toolType}
        options={toolTypes.map((t) => ({ value: t, label: TOOL_TYPE_LABELS[t] }))}
      />
      <FilterSelect
        name="condition"
        label="Condition"
        value={condition}
        options={toolConditions.map((c) => ({ value: c, label: c }))}
      />
      <FilterSelect
        name="status"
        label="Status"
        value={status}
        options={toolStatuses.map((s) => ({ value: s, label: s }))}
      />
    </div>
  );
}
