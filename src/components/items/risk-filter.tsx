"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { RiskFilter } from "@/modules/items/queries";

/**
 * The banner shown when the Item Tracker was opened from a dashboard tile.
 *
 * It exists to answer the question a filtered list always raises — "is this
 * everything?" — which is the one thing a silently filtered grid never
 * volunteers. Somebody who lands here from a tile and sees eleven rows should
 * not have to wonder whether the factory has eleven items or eleven overdue
 * ones.
 *
 * The state lives in the URL like every other filter on this screen (F22), so
 * the filtered list is a link Preeti can send to Punit.
 */
export function RiskBanner({ risk, count }: { risk: RiskFilter; count: number }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const clear = new URLSearchParams(params);
  clear.delete("risk");
  const clearHref = `${pathname}${clear.size ? `?${clear}` : ""}`;

  const overdue = risk === "overdue";
  // Due today is a fact about the calendar, not a warning — some of these are
  // READY and going out tonight — so it takes the neutral tone (L5).
  const neutral = risk === "due-today";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 ${
        overdue ? "bg-overdue-bg" : neutral ? "bg-neutral-status-bg" : "bg-at-risk-bg"
      }`}
    >
      <p
        className={`text-[13px] font-medium ${
          overdue ? "text-overdue" : neutral ? "text-neutral-status" : "text-at-risk"
        }`}
      >
        {overdue
          ? `${count} overdue item${count === 1 ? "" : "s"} — committed date passed, quantity still owed`
          : neutral
            ? `${count} item${count === 1 ? "" : "s"} committed for today`
            : `${count} item${count === 1 ? "" : "s"} at risk — committed soon and not yet ready`}
      </p>

      <Link href={clearHref} className="text-[13px] underline underline-offset-2">
        Show all items
      </Link>
    </div>
  );
}
