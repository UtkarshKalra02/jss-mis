"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MaterialOption } from "@/modules/materials/queries";
import { matchesQuery, queryWords, searchText } from "@/modules/materials/search";

/**
 * Choosing one of four hundred materials by typing, not by scrolling.
 *
 * THE NATIVE DROPDOWN COULD NOT BE SEARCHED. A browser's <select> jumps on the
 * first characters of an option, and every option here starts with its SKU —
 * so "sbs 25x36" matched nothing and the only way to a paper was to scroll the
 * whole list. That is the one control the store touches on every receipt.
 *
 * MATCHING IS WORD BY WORD, IN ANY ORDER, across SKU, name, type, category,
 * size, GSM and finish. "sbs 25x36 325" and "325 sbs 36" both find
 * P-SBS-007 — the store thinks in dimensions and weights, and in whatever
 * order they come to mind, never in the order the name happens to be written.
 *
 * The list is capped while typing and says so. Four hundred rows in a popover
 * is slow on the phone the store actually uses, and a list nobody can read to
 * the end of is not a list — but a silent cap would hide the paper somebody
 * is looking for, so it is never silent.
 *
 * Posts a hidden input, so the surrounding form submits exactly what the old
 * <select> did and no action or validation changed.
 */
const LIMIT = 60;

export function MaterialPicker({
  name,
  materials,
  value,
  onChange,
  id,
  label = "material",
  disabled,
}: {
  /** Field name to post. Omit for a picker that only drives other controls. */
  name?: string;
  materials: MaterialOption[];
  value: string;
  onChange: (materialId: string) => void;
  id?: string;
  /** Used in the accessible name: "Material, line 2". */
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () => materials.map((m) => ({ m, text: searchText(m) })),
    [materials],
  );

  const matches = useMemo(() => {
    const words = queryWords(query);
    if (words.length === 0) return rows;
    return rows.filter((r) => matchesQuery(r.text, words));
  }, [rows, query]);

  const shown = matches.slice(0, LIMIT);
  const chosen = materials.find((m) => m.id === value);

  return (
    <>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-label={chosen ? `${label}: ${chosen.sku} ${chosen.name}` : `${label}, none chosen`}
            className={cn(
              "border-input bg-background flex h-9 w-full items-center justify-between gap-2 rounded-md border px-2 text-left text-[13px]",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {chosen ? (
              <span className="truncate">
                <span className="tabular-nums">{chosen.sku}</span>
                <span className="text-muted-foreground"> — {chosen.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Search by SKU, name, size or GSM…</span>
            )}
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        </PopoverTrigger>

        {/* One width expression rather than a width with a min and a max: on a
            phone a min-width beats a max-width, which is how the first attempt
            at this ran off the side of the screen. At least 26rem so a paper's
            name is readable out of the GRN form's narrow table cell, as wide as
            the trigger where the trigger is wider, never wider than the screen. */}
        <PopoverContent
          align="start"
          className="w-[min(max(var(--radix-popover-trigger-width),26rem),calc(100vw-2rem))] p-0"
        >
          {/* shouldFilter off: the matching above is word-by-word across every
              field, which cmdk's own scoring does not do. */}
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="sbs 25x36 325 · duplex gray · nova nol"
            />
            <CommandList>
              <CommandEmpty>
                Nothing matches “{query}”. Try fewer words, or the SKU.
              </CommandEmpty>
              {shown.map(({ m }) => (
                <CommandItem
                  key={m.id}
                  value={m.id}
                  onSelect={() => {
                    onChange(m.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn("size-4 shrink-0", m.id === value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="tabular-nums">{m.sku}</span> — {m.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-[11px]">
                      {m.typeName}
                      {m.size ? ` · ${m.size}` : ""}
                      {m.gsm ? ` · ${m.gsm} GSM` : ""}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                    {formatQty(m.closingStock)} {m.unit}
                  </span>
                </CommandItem>
              ))}
              {matches.length > LIMIT ? (
                <p className="text-muted-foreground px-3 py-2 text-[11px]">
                  {matches.length - LIMIT} more match. Add a word to narrow it.
                </p>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
