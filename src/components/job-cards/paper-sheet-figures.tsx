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
  sheetsPerBundle,
  parts,
  ups,
  className,
  emptyText = "Enter a quantity and a bundle to see the sheet count.",
}: {
  qty: number | null | undefined;
  bundle: string | null | undefined;
  /** Only ever set for the manual bundle (V1). */
  sheetsPerBundle?: number | null | undefined;
  parts: number | null | undefined;
  /**
   * Pieces per press sheet (section Y). Omitted by the run sheet, which holds
   * no ups of its own — so the third figure simply does not appear there.
   */
  ups?: number | null | undefined;
  className?: string;
  /**
   * What to say when there is nothing to count. The default addresses somebody
   * who can type; a read-only screen passes its own, because telling a reader
   * to enter something into a page with no inputs is an instruction they
   * cannot follow.
   */
  emptyText?: string;
}) {
  const b = (bundle as PaperBundle | null) ?? null;
  const count = paperCount({ qty, bundle: b, sheetsPerBundle, parts, ups });
  const working = paperWorking({ qty, bundle: b, sheetsPerBundle });

  if (count.parentSheets === null) {
    return (
      <p className={cn("text-muted-foreground text-xs", className)}>{emptyText}</p>
    );
  }

  const cut = parts !== null && parts !== undefined && parts > 1;

  /*
   * The third figure appears only where ups is a field. The run sheet does not
   * pass it, so that form keeps the two columns it has always had rather than
   * growing an empty box.
   */
  const showPieces = ups !== undefined;

  return (
    <dl
      className={cn(
        "bg-muted/40 grid gap-4 rounded-md border p-3",
        showPieces ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2",
        className,
      )}
    >
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
      {showPieces ? (
        <div>
          <dt className="text-muted-foreground text-xs">Pieces off the run</dt>
          <dd className="text-[15px] tabular-nums">{formatQty(count.pieces)}</dd>
          <p className="text-muted-foreground text-[11px]">
            {count.pieces === null ? "enter ups to see this" : `${ups} up`}
          </p>
        </div>
      ) : null}
    </dl>
  );
}
