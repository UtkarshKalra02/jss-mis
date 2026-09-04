import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { paperCount, paperWorking, type PaperBundle } from "@/modules/job-cards/paper";

/**
 * Both sheet figures, side by side and equally weighted (J18).
 *
 * NO "use client" AND NO HOOKS, deliberately: this renders inside the live
 * form, which is a client component, and inside the card detail screen, which
 * is a server one. One component covering both is what stops the number
 * somebody types from disagreeing with the number somebody reads back.
 *
 * The godown and costing read the parent-sheet total, because that is what was
 * issued out of stock. The press and the cutter read the press-sheet total,
 * because cutting happens before printing and that is the run length. Showing
 * only one of them would leave whoever needed the other doing the arithmetic on
 * a phone, which is the habit this band exists to remove.
 */
export function PaperSheetFigures({
  qty,
  bundle,
  parts,
  className,
}: {
  qty: number | null | undefined;
  bundle: string | null | undefined;
  parts: number | null | undefined;
  className?: string;
}) {
  const count = paperCount({ qty, bundle: (bundle as PaperBundle | null) ?? null, parts });
  const working = paperWorking({ qty, bundle: (bundle as PaperBundle | null) ?? null });

  if (count.parentSheets === null) {
    return (
      <p className={cn("text-muted-foreground text-xs", className)}>
        Enter a quantity and a bundle to see the sheet count.
      </p>
    );
  }

  const cut = parts !== null && parts !== undefined && parts > 1;

  return (
    <dl className={cn("bg-muted/40 grid grid-cols-2 gap-4 rounded-md border p-3", className)}>
      <div>
        <dt className="text-muted-foreground text-xs">Parent sheets</dt>
        <dd className="text-[15px] tabular-nums">{formatQty(count.parentSheets)}</dd>
        {working ? <p className="text-muted-foreground text-[11px]">{working}</p> : null}
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">Press sheets, after cutting</dt>
        <dd className="text-[15px] tabular-nums">{formatQty(count.pressSheets)}</dd>
        <p className="text-muted-foreground text-[11px]">
          {cut ? `cut into ${parts} parts` : "uncut"}
        </p>
      </div>
    </dl>
  );
}
