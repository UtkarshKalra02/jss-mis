"use client";

import Link from "next/link";

import type { Lang } from "@/modules/planning/floor-plan";

/**
 * The screen-only controls above the floor plan: back, the language toggle,
 * and Print. Hidden in the print itself, like the job card's PrintBar.
 *
 * THE LANGUAGE IS IN THE URL, so a Hindi sheet can be bookmarked and the
 * browser's own print does the right thing. No auto-print on mount, for the
 * reason the job card gives: a dialog that opens by itself makes the sheet
 * impossible to check before printing.
 */
export function FloorPlanBar({ date, lang }: { date: string; lang: Lang }) {
  const other: Lang = lang === "en" ? "hi" : "en";

  return (
    <div className="print-hide mx-auto mb-4 max-w-[186mm]">
      <div className="flex items-center justify-between">
        <Link
          href={`/planning?date=${date}`}
          className="text-[13px] text-neutral-600 hover:underline"
        >
          ← Job planning
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href={`/planning/print?date=${date}&lang=${other}`}
            className="h-8 rounded-md border border-neutral-300 px-3 text-[13px] leading-8 text-neutral-800 hover:bg-neutral-100"
            lang={other}
          >
            {other === "hi" ? "हिंदी में" : "In English"}
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="h-8 rounded-md bg-neutral-900 px-3 text-[13px] font-medium text-white hover:bg-neutral-700"
          >
            Print
          </button>
        </div>
      </div>

      {/* Honest about what the Hindi is (L3). The stage names come from Admin
          › Stages and fall back to English until typed; the headings are the
          build's own wording and have not been checked on the floor. */}
      {lang === "hi" ? (
        <p className="mt-2 text-[12px] text-neutral-600">
          Stage names print in Hindi only where one has been entered on Admin › Stages;
          otherwise the English name is used. The column headings are unverified
          translations — correct them in <code>floor-plan.ts</code> if the floor reads them
          differently.
        </p>
      ) : null}
    </div>
  );
}
