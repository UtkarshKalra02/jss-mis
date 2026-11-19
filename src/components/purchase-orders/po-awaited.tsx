import { cn } from "@/lib/utils";

/**
 * "PO awaited" (N1), wherever an order is named.
 *
 * GREY, DELIBERATELY. Section 7 reserves red and amber for late and at-risk,
 * and an item whose PO has not arrived is neither — the work is on schedule
 * and the paperwork is following, which is the ordinary order of things here.
 * The marker exists so nobody looks up a client PO number that does not exist
 * yet, not to make anybody chase one.
 *
 * One component rather than a string repeated on eight screens, so the
 * wording — Utkarsh's — changes in one place if it ever changes.
 */
export function PoAwaited({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-neutral-status-bg text-neutral-status rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap",
        className,
      )}
      title="The client's PO number has not been recorded yet. Work and dispatch carry on; the number is added when it arrives."
    >
      PO awaited
    </span>
  );
}

/** The plain-text form, for printed sheets that cannot carry a pill. */
export const PO_AWAITED_TEXT = "PO awaited";

/**
 * "Job work" (section Z), wherever an order is named.
 *
 * GREY, like PO awaited above and for the same reason: section 7 reserves red
 * and amber for late and at risk, and job work is neither — it is an ordinary
 * kind of order, not a problem.
 *
 * IT REPLACES "PO awaited" RATHER THAN JOINING IT. A job-work order has no PO
 * number and never will, so `po_awaited` is false for it by definition (the
 * expression in v_po_item_status says so). The two can therefore never show
 * together, which is the whole point of section Z: one marker says "the
 * document is following", the other says "there is no document".
 */
export function JobWork({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-neutral-status-bg text-neutral-status rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap",
        className,
      )}
      title="The client sent their own material and asked for a process. There is no client PO and none is coming."
    >
      Job work
    </span>
  );
}

/** The plain-text form, for printed sheets that cannot carry a pill. */
export const JOB_WORK_TEXT = "Job work";
