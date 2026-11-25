"use client";

import { MoreHorizontal } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setPoItemManuallyClosedAction, type FormState } from "@/modules/purchase-orders/actions";

const initialState: FormState = { ok: false, error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Closing a job from the Item Tracker — section X's decision, on the screen
 * where it is actually noticed (X9).
 *
 * WHY HERE. The control existed only on an item's page under its purchase
 * order, which is two clicks from the one screen that shows you the stale work
 * in the first place: the tracker is where somebody sees forty rows and
 * recognises the three that are never going to be finished. Utkarsh,
 * 25 Nov 2026: "I need close job option in item tracker as well and item menu."
 *
 * WHAT IT DOES NOT DO. It does not close anything in bulk, and the reason is
 * not caution about the write — it is that `close_reason` is per item and
 * required. A bulk close would either ask for one sentence to cover several
 * jobs, which is a sentence that explains none of them, or ask for several in
 * one dialog, which is the dialog nobody finishes. Each one is its own
 * decision, typed once, read back at review.
 *
 * The menu never offers what the server will refuse. A fully-delivered item
 * has nothing to write off; a cancelled one was never delivered at all; one
 * whose PO is younger than the waiting period is told the date instead. All
 * three come from the same row the table is already showing, and the action
 * and the 0048 trigger check every one of them again.
 */
export function ItemCloseControl({
  itemId,
  itemCode,
  pendingQty,
  status,
  closedByHand,
  minDays,
  earliest,
  eligible,
}: {
  itemId: string;
  itemCode: string;
  pendingQty: number;
  status: string;
  /** Closed by a person, as opposed to closed by full delivery. */
  closedByHand: boolean;
  minDays: number;
  earliest: string;
  eligible: boolean;
}) {
  const [state, formAction] = useActionState(setPoItemManuallyClosedAction, initialState);
  const [open, setOpen] = useState(false);
  const reasonId = useId();

  /*
   * The row is re-read by the server on success (the action revalidates
   * /items), so the dialog's job is done the moment it reports ok — holding it
   * open would show a form for a decision already taken.
   */
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  const cancelled = status === "Cancelled";
  const deliveredClosed = status === "Closed" && !closedByHand;

  // Nothing to offer: the status is already final for a reason that has
  // nothing to do with writing off a balance.
  if (cancelled || deliveredClosed) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
            aria-label={`Actions for ${itemCode}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {closedByHand ? (
            <DropdownMenuItem onSelect={() => setOpen(true)}>Reopen job…</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setOpen(true)}>Close job…</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {closedByHand ? "Reopen" : "Close"} {itemCode}
            </DialogTitle>
            <DialogDescription>
              {closedByHand
                ? "Puts the job back to whatever the dispatched quantity says. An item that was fully delivered before it was closed comes back as Closed."
                : "For a job that is over without being finished — the balance will never be printed. This is not the same as cancelling, which says the order never happened."}
            </DialogDescription>
          </DialogHeader>

          {closedByHand ? (
            <form action={formAction} className="space-y-3">
              <input type="hidden" name="id" value={itemId} />
              <input type="hidden" name="close" value="false" />
              <DialogFooter>
                <Submit label="Reopen job" />
              </DialogFooter>
            </form>
          ) : !eligible ? (
            <>
              <p className="border-at-risk/40 bg-at-risk-bg rounded-lg border p-3 text-[13px]">
                Not yet. A job can only be closed by hand {minDays} days after its PO date,
                so the earliest for this one is <strong>{earliest}</strong>. If the order
                went away rather than fell short, cancel it instead — that is on the
                item&rsquo;s own page.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form action={formAction} className="space-y-3">
              <input type="hidden" name="id" value={itemId} />
              <input type="hidden" name="close" value="true" />

              <p className="text-[13px]">
                <strong>{pendingQty.toLocaleString("en-IN")} pcs are written off.</strong>{" "}
                Stage events and dispatches stay exactly as they are.
              </p>

              <div className="space-y-2">
                <Label htmlFor={reasonId}>Why is this job being closed?</Label>
                <Textarea
                  id={reasonId}
                  name="reason"
                  rows={3}
                  required
                  minLength={10}
                  maxLength={500}
                  placeholder="e.g. Client confirmed on call they do not want the balance 2,400 pcs — season over."
                />
                <p className="text-muted-foreground text-xs">
                  Read back at review. A reason is required and recorded against your name.
                </p>
              </div>

              <DialogFooter>
                <Submit label="Close job" />
              </DialogFooter>
            </form>
          )}

          {state.error ? (
            <p role="alert" className="text-overdue text-[13px]">
              {state.error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
