"use client";

import { useId, useState } from "react";

import { paperBundleValues } from "@/modules/job-cards/validation";
import { isManualBundle, SHEETS_PER_BUNDLE, type PaperBundle } from "@/modules/job-cards/paper";

import { PaperSheetFigures } from "./paper-sheet-figures";

/**
 * The paper quantity control, and the two figures it produces (J18).
 *
 * ONE COMPONENT, used by the job card form and the run sheet form, for the
 * same reason `resolvedSheet()` is one function: a second copy is how the
 * arithmetic on the card stops matching the arithmetic on the plate.
 *
 * The totals are computed as the person types and are never posted. Only
 * quantity, bundle and parts go to the server — the sheet counts are derived
 * again wherever they are shown, on non-negotiable 2's rule.
 */
export function PaperQuantity({
  qty,
  bundle,
  sheetsPerBundle,
  parts,
  className,
}: {
  qty?: number | null;
  bundle?: string | null;
  /** Only ever set for the manual bundle (V1). */
  sheetsPerBundle?: number | null;
  parts?: number | null;
  className?: string;
}) {
  const ids = useId();
  const [q, setQ] = useState(qty?.toString() ?? "");
  const [b, setB] = useState((bundle as PaperBundle | null) ?? "");
  const [spb, setSpb] = useState(sheetsPerBundle?.toString() ?? "");
  const [p, setP] = useState(parts?.toString() ?? "");

  const manual = isManualBundle(b === "" ? null : (b as PaperBundle));

  const inputClass =
    "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

  return (
    <div className={className}>
      <div className={`grid gap-4 ${manual ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">Quantity</span>
          <input
            id={`${ids}-qty`}
            name="paperQty"
            type="number"
            min={1}
            inputMode="numeric"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">Bundle</span>
          <select
            id={`${ids}-bundle`}
            name="paperBundle"
            value={b}
            onChange={(e) => setB(e.target.value as PaperBundle | "")}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {paperBundleValues.map((v) => (
              <option key={v} value={v}>
                {SHEETS_PER_BUNDLE[v] === null ? `${v} — type the size` : `${v} — ${SHEETS_PER_BUNDLE[v]} sheets`}
              </option>
            ))}
          </select>
        </label>

        {/* Only the manual bundle carries a size. The database refuses to
            store one against Packet, Ream or Gross, so the box does not
            appear for them rather than appearing and being ignored. */}
        {manual ? (
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Sheets per bundle</span>
            <input
              id={`${ids}-spb`}
              name="paperSheetsPerBundle"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="460"
              value={spb}
              onChange={(e) => setSpb(e.target.value)}
              className={inputClass}
            />
          </label>
        ) : null}

        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">Parts</span>
          <input
            id={`${ids}-parts`}
            name="paperParts"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="1"
            value={p}
            onChange={(e) => setP(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {/* A quantity with no bundle is refused by zod and by the database. Say
          so here, where the person can still fix it, rather than letting the
          save come back with it. */}
      {q !== "" && b === "" ? (
        <p className="text-at-risk mt-2 text-xs">
          Choose a bundle — a quantity on its own does not say how much paper.
        </p>
      ) : null}

      {/* The manual bundle's own version of the same gap: a count of bundles
          whose size nobody has said is exactly as uninformative. */}
      {manual && q !== "" && spb === "" ? (
        <p className="text-at-risk mt-2 text-xs">
          Say how many sheets are in a bundle — 5 bundles says nothing without it.
        </p>
      ) : null}

      {/* The same component the card screen renders, so what is typed and
          what is read back cannot disagree. */}
      <PaperSheetFigures
        className="mt-3"
        qty={q === "" ? null : Number(q)}
        bundle={b === "" ? null : b}
        sheetsPerBundle={spb === "" ? null : Number(spb)}
        parts={p === "" ? null : Number(p)}
      />
    </div>
  );
}
