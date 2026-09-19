"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { CategoryOption } from "@/modules/materials/queries";

/** The one filter the stock list needs. Lives in the URL, so a filtered list is a link. */
export function CategoryFilter({
  value,
  categories,
}: {
  value: string;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="text-[12px]">
      <span className="text-muted-foreground block">Category</span>
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set("category", e.target.value);
          else next.delete("category");
          router.replace(next.size > 0 ? `${pathname}?${next}` : pathname);
        }}
        className="border-input bg-background mt-1 h-9 rounded-md border px-2 text-[13px]"
      >
        <option value="">All</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
