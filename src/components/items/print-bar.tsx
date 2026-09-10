"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The screen-only chrome on the pending-work sheet.
 *
 * Carries the back link, the shape toggle and the Print button, and every bit
 * of it is `print-hide` — none of it belongs on the paper.
 *
 * THE TOGGLE CHANGES THE URL, not component state. The sheet is a link like
 * every filtered view in this system (F22): the shape you chose survives a
 * refresh, can be sent to somebody, and the browser's own Ctrl-P prints
 * whichever one is on screen without this component being involved at all.
 *
 * No auto-`window.print()` on mount, for the reason the job card's bar gives:
 * a dialog that opens by itself makes the page impossible to simply look at,
 * which is what somebody checking the sheet before printing forty copies wants
 * to do.
 */
export function ItemsPrintBar({ group }: { group: "stage" | "urgency" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setGroup = (next: "stage" | "urgency") => {
    const q = new URLSearchParams(params.toString());
    q.set("group", next);
    router.replace(`${pathname}?${q}`);
  };

  const tab = (value: "stage" | "urgency", label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setGroup(value)}
      aria-pressed={group === value}
      className={cn(
        "h-8 rounded-md px-2.5 text-[13px]",
        group === value
          ? "bg-neutral-900 font-medium text-white"
          : "text-neutral-600 hover:bg-neutral-200",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="print-hide mx-auto mb-4 flex max-w-[186mm] flex-wrap items-center justify-between gap-3">
      <Link href="/items" className="text-[13px] text-neutral-600 hover:underline">
        ← Item tracker
      </Link>

      <div className="flex items-center gap-1 rounded-md bg-neutral-100 p-1">
        {tab("stage", "By stage")}
        {tab("urgency", "Most urgent first")}
      </div>

      <button
        type="button"
        onClick={() => window.print()}
        className="h-8 rounded-md bg-neutral-900 px-3 text-[13px] font-medium text-white hover:bg-neutral-700"
      >
        Print
      </button>
    </div>
  );
}
