"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";

/**
 * Search and filter for the job card list, both living in the URL.
 *
 * Same shape and same reasoning as the Item Tracker's (F22): a search is a
 * link, the back button does what it appears to, and the matching rules stay
 * in one SQL statement rather than half-duplicated in the browser.
 */
export function JobCardSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [value, setValue] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (value === initialQuery) return;

    // Debounced, or every keystroke is a database round trip. 250ms is short
    // enough to feel immediate and long enough that "JC-2026" is one query.
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");

      startTransition(() => router.replace(`${pathname}?${next}`));
    }, 250);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-full max-w-lg">
      <Search className="text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Card number, item, client or machine…"
        aria-label="Search job cards"
        className={`h-9 pl-8 text-[13px] ${isPending ? "opacity-70" : ""}`}
      />
    </div>
  );
}

/**
 * Defaults ON.
 *
 * "Open" is a card the floor could still be working from — Planned, In Process
 * or On Hold. A completed card is history, and this week's six buried under two
 * years of them is the failure the tracker's open-only default exists to
 * prevent.
 */
export function OpenCardsToggle({ openOnly }: { openOnly: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-[13px]">
      <input
        type="checkbox"
        checked={openOnly}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.checked) next.delete("all");
          else next.set("all", "1");
          router.replace(`${pathname}?${next}`);
        }}
        className="accent-primary size-4"
      />
      Open cards only
    </label>
  );
}
