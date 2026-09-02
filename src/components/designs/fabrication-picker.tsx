"use client";

import { useState } from "react";

import type { FabricationOptionRow, Selection } from "@/modules/fabrication/queries";

/**
 * The design's fabrication specification — what is DONE to the paper.
 *
 * NOT the route. The Route section above decides which STAGES a job passes
 * through; this decides what happens to it, and the two are separate
 * vocabularies because the paper job card lists three laminations, two UV
 * lines and four pasting lines under what the stage table calls three stages
 * (J8).
 *
 * A ticked option reveals its own control and nothing else. That keeps the
 * section short for the common design — most have one or two finishes — while
 * a heavily finished job can still say exactly what it needs. Untick and the
 * control disappears with it.
 *
 * RUN-SCOPE OPTIONS SHOW NO VALUE PICKER HERE, deliberately. New-die-or-old is
 * a fact about a run, not about the design: the design does not change between
 * orders and the die stops being new after the first. The tick says the design
 * has a die; the job card says whether this run cut a new one.
 *
 * Everything posts as parallel arrays, one entry per ticked row, on the same
 * reasoning as the PO form's item rows (F20): each ticked row renders every
 * field including the empty ones, so index i is row i and a conditionally
 * omitted input cannot shift every later row by one.
 */
export function FabricationPicker({
  options,
  selected,
}: {
  options: FabricationOptionRow[];
  /** What the design already has, keyed by option id. */
  selected: Map<string, Selection>;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set(selected.keys()));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([...selected].map(([id, s]) => [id, s.valueId ?? ""])),
  );
  const [others, setOthers] = useState<Record<string, string>>(() =>
    Object.fromEntries([...selected].map(([id, s]) => [id, s.otherText ?? ""])),
  );

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">Fabrication</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          What is done to the paper, and how. This prints on the job card with its answer
          filled in — the floor should not have to write &ldquo;matt&rdquo; on the sheet.
        </p>
      </div>

      <ul className="space-y-1.5">
        {options.map((option) => {
          const on = ticked.has(option.id);
          const value = values[option.id] ?? "";
          const isOther =
            option.allowsFreeText &&
            option.values.find((v) => v.id === value)?.value === "Other";

          return (
            <li
              key={option.id}
              className={`rounded-md border px-3 py-2 ${on ? "bg-muted/40" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(option.id)}
                    className="accent-primary size-4"
                  />
                  <span className="text-[13px] font-medium">{option.label}</span>
                </label>

                {on && option.valueScope === "Design" && option.values.length > 0 ? (
                  <select
                    value={value}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [option.id]: e.target.value }))
                    }
                    aria-label={`${option.label} — which`}
                    className="border-input bg-background h-8 rounded-md border px-2 text-[13px]"
                  >
                    <option value="">Choose…</option>
                    {option.values.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.value}
                      </option>
                    ))}
                  </select>
                ) : null}

                {on && option.valueScope === "Run" ? (
                  <span className="text-muted-foreground text-[12px]">
                    {option.values.map((v) => v.value).join(" or ")} — set on each job card,
                    not here
                  </span>
                ) : null}

                {on && isOther ? (
                  <input
                    value={others[option.id] ?? ""}
                    onChange={(e) =>
                      setOthers((o) => ({ ...o, [option.id]: e.target.value }))
                    }
                    placeholder="Which foil?"
                    aria-label={`${option.label} — other`}
                    className="border-input bg-background h-8 grow rounded-md border px-2 text-[13px]"
                  />
                ) : null}
              </div>

              {/* Every ticked row posts all three fields, empty ones included. */}
              {on ? (
                <>
                  <input type="hidden" name="fabricationOptionId" value={option.id} />
                  <input
                    type="hidden"
                    name="fabricationValueId"
                    value={option.valueScope === "Design" ? value : ""}
                  />
                  <input
                    type="hidden"
                    name="fabricationOtherText"
                    value={isOther ? (others[option.id] ?? "") : ""}
                  />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
