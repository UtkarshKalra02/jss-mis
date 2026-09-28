"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategoryCount } from "@/modules/materials/queries";

/**
 * The store's categories as tabs, All first (P8).
 *
 * REPLACES THE CATEGORY DROPDOWN. Paper is about half the store and the only
 * material a job card consumes by size and GSM, so "show me the paper" is the
 * commonest thing anybody does here — and a dropdown makes the commonest
 * action two clicks and a read. A tab is one click and already visible.
 *
 * THE TABS ARE DATA, NOT A LIST IN THIS FILE (non-negotiable 5). They come
 * from what the store actually holds, so a category added on the master
 * appears here without a deploy, and one nothing is filed under does not
 * appear at all.
 *
 * The count beside each respects the search box, so with a word typed the
 * strip says where the matches are rather than repeating a constant.
 *
 * Stays in the URL like every other filter (F22): a filtered list is a link.
 */
export function CategoryTabs({
  value,
  counts,
  total,
}: {
  value: string;
  counts: CategoryCount[];
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const go = (categoryId: string) => {
    const next = new URLSearchParams(params.toString());
    if (categoryId) next.set("category", categoryId);
    else next.delete("category");
    startTransition(() =>
      router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false }),
    );
  };

  const tabs = [{ categoryId: "", categoryName: "All", n: total }, ...counts];

  return (
    <div
      role="tablist"
      aria-label="Material category"
      /* Scrolls sideways rather than wrapping: ten tabs on a phone wrap into
         three ragged rows, and the store works on a phone. */
      className={cn(
        "-mx-1 flex gap-1 overflow-x-auto px-1 pb-1",
        isPending && "opacity-70",
      )}
    >
      {tabs.map((t) => {
        const active = t.categoryId === value;
        return (
          <button
            key={t.categoryId || "all"}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => go(t.categoryId)}
            className={cn(
              "flex shrink-0 items-baseline gap-1.5 rounded-md border px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              active
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "hover:bg-muted/50 border-transparent",
            )}
          >
            {t.categoryName}
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
