"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TypeCount } from "@/modules/materials/queries";

/**
 * Paper types as tabs — SBS, Duplex, Art, Kraft (P9).
 *
 * The same strip as the store's categories (P8), one level down: there the
 * question is "which kind of thing", here it is "which kind of paper", which
 * is what the godown actually divides its racks by.
 *
 * Types come from what the store holds, never a list in this file
 * (non-negotiable 5), and the counts obey the search box.
 */
export function TypeTabs({
  value,
  types,
  total,
}: {
  value: string;
  types: TypeCount[];
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const go = (typeId: string) => {
    const next = new URLSearchParams(params.toString());
    if (typeId) next.set("type", typeId);
    else next.delete("type");
    startTransition(() =>
      router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false }),
    );
  };

  const tabs = [{ typeId: "", typeName: "All paper", n: total }, ...types];

  return (
    <div
      role="tablist"
      aria-label="Paper type"
      /* Scrolls sideways rather than wrapping — the store works on a phone. */
      className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 pb-1", isPending && "opacity-70")}
    >
      {tabs.map((t) => {
        const active = t.typeId === value;
        return (
          <button
            key={t.typeId || "all"}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => go(t.typeId)}
            className={cn(
              "flex shrink-0 items-baseline gap-1.5 rounded-md border px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              active
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "hover:bg-muted/50 border-transparent",
            )}
          >
            {t.typeName}
            <span
              className={cn(
                "text-[11px] tabular-nums",
                active ? "text-primary/70" : "text-muted-foreground",
              )}
            >
              {formatQty(t.n)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
