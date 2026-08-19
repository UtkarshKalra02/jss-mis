"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * "Open only", in the URL alongside the query so the whole screen stays
 * shareable as a link.
 *
 * Defaults ON. The question this screen answers is almost always about work in
 * progress, and a tracker that buries eighty live items under two years of
 * delivered ones answers it slowly.
 */
export function OpenOnlyToggle({ openOnly }: { openOnly: boolean }) {
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
      Open items only
    </label>
  );
}
