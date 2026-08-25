"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * "Created by import, unreviewed" (decision F32), in the URL so the filtered
 * list is a link — the same reasoning as the Item Tracker's search state (F22).
 *
 * Defaults OFF, unlike the tracker's "open items only". The everyday question
 * this screen answers is "who are our clients?", and the answer is all of them;
 * the tidying-up job is occasional and deliberate, so it is something you turn
 * on rather than something you keep turning off.
 */
export function ImportedFilter({
  enabled,
  unreviewedCount,
}: {
  enabled: boolean;
  unreviewedCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Nothing to tidy and nothing being hidden: a control that can only ever
  // produce an empty list is a question rather than a tool.
  if (unreviewedCount === 0 && !enabled) return null;

  return (
    <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-[13px]">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.checked) next.set("imported", "1");
          else next.delete("imported");
          router.replace(next.size > 0 ? `${pathname}?${next}` : pathname);
        }}
        className="accent-primary size-4"
      />
      Created by import, unreviewed
      {unreviewedCount > 0 ? (
        <span className="bg-at-risk-bg text-at-risk rounded-full px-1.5 text-[11px] tabular-nums">
          {unreviewedCount}
        </span>
      ) : null}
    </label>
  );
}
