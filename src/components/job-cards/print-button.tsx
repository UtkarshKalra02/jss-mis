"use client";

import Link from "next/link";

/**
 * The only interactive thing on a printable page, and it is hidden in the
 * print itself.
 *
 * There is deliberately no auto-`window.print()` on mount. A dialog that opens
 * by itself makes the page impossible to simply look at — which is what
 * somebody checking a card before releasing a stack of them wants to do — and
 * the browser's own Ctrl/Cmd-P does the same job for anybody in a hurry.
 */
export function PrintBar({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="print-hide mx-auto mb-4 flex max-w-[186mm] items-center justify-between">
      <Link href={backHref} className="text-[13px] text-neutral-600 hover:underline">
        ← {backLabel}
      </Link>

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
