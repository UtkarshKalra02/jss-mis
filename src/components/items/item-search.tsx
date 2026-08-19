"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";

/**
 * The search box for spec 6.4.
 *
 * The query lives in the URL rather than in component state, so a search is a
 * link: Preeti can send Punit the exact screen she is looking at, and the back
 * button does what it looks like it does. The server component reads the same
 * parameter and does the query, which keeps the matching rules in SQL rather
 * than duplicated in the browser.
 *
 * Debounced, because every keystroke is a database round trip otherwise. 250ms
 * is short enough to feel immediate at typing speed and long enough that
 * "NAT-2026" is one query rather than eight.
 */
export function ItemSearch({ initialQuery }: { initialQuery: string }) {
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
    <div className="relative max-w-lg">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Item code, name, client, PO number, job card…"
        className="pl-9"
        aria-label="Search items"
        autoFocus
      />
      {isPending ? (
        <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-xs">
          searching…
        </span>
      ) : null}
    </div>
  );
}
