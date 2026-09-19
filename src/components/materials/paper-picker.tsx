"use client";

import { useId, useMemo, useState } from "react";

import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { paperCandidates } from "@/modules/materials/gsm";
import type { PaperOption } from "@/modules/materials/queries";

const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * The job card's paper band, backed by the store (decision O2).
 *
 * Three narrowing controls — type, size, GSM — and under them the papers in
 * stock that fit, NEAREST GSM FIRST within the tolerance from app_setting.
 * "Use" fills the card's size, GSM and finish from the master and records
 * which paper (`materialId`); the planner can still overtype any of the
 * three, and can pick nothing at all, which leaves the card exactly as it
 * was before the store existed.
 *
 * The three text fields keep their old names, so the release and edit
 * actions read them unchanged, and a card for a paper the store does not
 * hold is still just typed. What the picker adds is the id and the stock
 * figure; nothing here moves stock (O3).
 */
export function PaperPicker({
  papers,
  tolerancePct,
  defaults,
  preferredMaterialId,
}: {
  papers: PaperOption[];
  tolerancePct: number;
  defaults: {
    materialId?: string | null;
    paperSize?: string | null;
    paperGsm?: string | null;
    paperFinish?: string | null;
  };
  /** The design's usual paper (O6), offered first when the card has none yet. */
  preferredMaterialId?: string | null;
}) {
  const id = useId();

  const initial = papers.find((p) => p.id === (defaults.materialId ?? preferredMaterialId));

  const [typeId, setTypeId] = useState(initial?.typeId ?? "");
  const [size, setSize] = useState(defaults.paperSize ?? initial?.size ?? "");
  const [gsm, setGsm] = useState(defaults.paperGsm ?? (initial?.gsm ? String(initial.gsm) : ""));
  const [finish, setFinish] = useState(defaults.paperFinish ?? initial?.finish ?? "");
  const [materialId, setMaterialId] = useState(defaults.materialId ?? initial?.id ?? "");

  /*
   * What the JOB asked for, kept apart from what the card will say. Choosing
   * the 290 substitute for a 300 job sets the card's GSM to 290 — that is the
   * paper it will print on — but the list stays ranked around 300, so the 300
   * boards do not suddenly read as substitutes for the substitute. Only
   * typing in the GSM box moves the anchor.
   */
  const [wanted, setWanted] = useState(gsm);

  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of papers) if (!seen.has(p.typeId)) seen.set(p.typeId, p.typeName);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [papers]);

  const sizes = useMemo(
    () =>
      [...new Set(papers.filter((p) => !typeId || p.typeId === typeId).map((p) => p.size ?? ""))]
        .filter(Boolean)
        .sort(),
    [papers, typeId],
  );

  const wantedGsm = Number(wanted);
  const candidates = useMemo(
    () =>
      paperCandidates(
        papers,
        { typeId: typeId || null, size: size || null, gsm: Number.isFinite(wantedGsm) ? wantedGsm : null },
        tolerancePct,
      ),
    [papers, typeId, size, wantedGsm, tolerancePct],
  );

  const chosen = papers.find((p) => p.id === materialId);

  const use = (p: PaperOption) => {
    setMaterialId(p.id);
    setTypeId(p.typeId);
    setSize(p.size ?? "");
    setGsm(p.gsm ? String(p.gsm) : "");
    setFinish(p.finish ?? "");
  };

  return (
    <div className="space-y-3">
      <input type="hidden" name="materialId" value={materialId} />

      <div className="grid gap-4 sm:grid-cols-4">
        <label className="space-y-1 text-[13px]">
          <span className="text-muted-foreground text-xs">Paper type</span>
          <select
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              setMaterialId("");
            }}
            className={inputClass}
            aria-label="Paper type"
          >
            <option value="">Any</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-[13px]">
          <span className="text-muted-foreground text-xs">Size</span>
          <input
            name="paperSize"
            list={`${id}-sizes`}
            value={size}
            onChange={(e) => {
              setSize(e.target.value);
              setMaterialId("");
            }}
            placeholder="23X36"
            className={inputClass}
          />
          <datalist id={`${id}-sizes`}>
            {sizes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <label className="space-y-1 text-[13px]">
          <span className="text-muted-foreground text-xs">GSM</span>
          <input
            name="paperGsm"
            type="number"
            min={1}
            step={1}
            value={gsm}
            onChange={(e) => {
              setGsm(e.target.value);
              setWanted(e.target.value);
              setMaterialId("");
            }}
            placeholder="300"
            className={`${inputClass} text-right tabular-nums`}
          />
        </label>

        <label className="space-y-1 text-[13px]">
          <span className="text-muted-foreground text-xs">Matt / gloss</span>
          <input
            name="paperFinish"
            value={finish}
            onChange={(e) => setFinish(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {/* What the store has that fits. Empty when nothing is narrowed yet,
          because "every paper in the building" is a list, not an answer. */}
      {typeId || size || wanted ? (
        candidates.length === 0 ? (
          <p className="text-muted-foreground text-[12px]">
            Nothing in the store matches
            {wanted ? ` ${wanted} GSM ±${tolerancePct}%` : ""}
            {size ? ` in ${size}` : ""}. The card keeps what you typed; the paper is not linked
            to stock.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="data-grid w-full">
              <thead>
                <tr>
                  <th className="px-2">SKU</th>
                  <th className="px-2">Paper</th>
                  <th className="px-2 text-right">GSM</th>
                  <th className="px-2 text-right">In stock</th>
                  <th className="w-20 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {candidates.slice(0, 8).map((p) => {
                  const exact = Number.isFinite(wantedGsm) && wantedGsm > 0 && p.gsm === wantedGsm;
                  const none = Number(p.closingStock) <= 0;
                  const selected = p.id === materialId;
                  return (
                    <tr key={p.id} className={cn(selected && "bg-neutral-status-bg")}>
                      <td className="px-2 tabular-nums">{p.sku}</td>
                      <td className="px-2">
                        {p.name}
                        {!exact && wantedGsm > 0 ? (
                          <span className="text-muted-foreground ml-2 text-[11px]">substitute</span>
                        ) : null}
                      </td>
                      <td className="px-2 text-right tabular-nums">{p.gsm ?? "—"}</td>
                      <td className={cn("px-2 text-right tabular-nums", none && "text-overdue")}>
                        {formatQty(p.closingStock)} sheets
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => use(p)}
                          className="text-primary text-[12px] hover:underline"
                        >
                          {selected ? "Chosen" : "Use"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {chosen ? (
        <p className="text-[12px]">
          Linked to <span className="tabular-nums">{chosen.sku}</span> — {formatQty(chosen.closingStock)}{" "}
          sheets in stock. Stock does not move until the paper is issued against this card.
        </p>
      ) : null}
    </div>
  );
}
