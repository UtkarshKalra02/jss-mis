"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Search the store by SKU, name, size or type — in the URL, debounced, the
 * same shape as the tooling register's box. On a phone this is the only way
 * into a 400-row list; on the desktop the grid's column filters still work.
 */
export function MaterialSearch({ initialQuery }: { initialQuery: string }) {
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
      startTransition(() => router.replace(next.size > 0 ? `${pathname}?${next}` : pathname));
    }, 250);
    return () => clearTimeout(timer);
  }, [value, initialQuery, params, pathname, router]);

  return (
    <div className="relative w-full max-w-lg">
      <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="SKU, name, size or type"
        aria-label="Search materials"
        className={cn("pl-9", isPending && "opacity-70")}
      />
    </div>
  );
}
