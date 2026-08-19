"use client";

import { useActionState, useEffect, useId } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createQuickDesignAction,
  type QuickDesignState,
} from "@/modules/designs/actions";
import type { DesignOption } from "@/modules/purchase-orders/queries";

const initialState: QuickDesignState = { ok: false, error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Creating…" : "Create design"}
    </Button>
  );
}

/**
 * "Search existing or create" (spec 6.3), without leaving PO capture.
 *
 * Asks only for what is on the purchase order in front of the person. Die and
 * plate references, the route, artwork and approval are all things they do not
 * have yet and would invent if asked, so the dialog says plainly that those are
 * filled in later on the Design master.
 *
 * The dialog CONTENT is portalled to the body by Radix, so this form is not
 * nested inside the PO form in the DOM — which would be invalid HTML and would
 * submit the wrong thing.
 */
export function QuickDesignDialog({
  open,
  onOpenChange,
  clientId,
  clientLabel,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientLabel: string;
  onCreated: (design: DesignOption) => void;
}) {
  const [state, formAction] = useActionState(createQuickDesignAction, initialState);
  const formId = useId();

  useEffect(() => {
    if (state.ok && state.design) {
      onCreated(state.design);
      onOpenChange(false);
    }
    // onCreated closes over the row it belongs to and is redefined each render;
    // keying this on the action result alone is what makes it fire once.
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New design</DialogTitle>
          <DialogDescription>
            For {clientLabel}. The code is allocated on save, and it is selected on this
            item straight away. Die, plate, route and artwork are filled in later on the
            Designs screen.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="space-y-2">
            <Label htmlFor={`${formId}-jobName`}>Job name</Label>
            <Input
              id={`${formId}-jobName`}
              name="jobName"
              required
              autoFocus
              placeholder="250ml carton — outer"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-jobSize`}>Size</Label>
              <Input id={`${formId}-jobSize`} name="jobSize" placeholder="12 × 8 × 4 cm" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-paperType`}>Paper</Label>
              <Input id={`${formId}-paperType`} name="paperType" placeholder="SBS board" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-gsm`}>GSM</Label>
              <Input id={`${formId}-gsm`} name="gsm" placeholder="300" inputMode="numeric" />
            </div>
          </div>

          {state.error ? (
            <p role="alert" className="text-overdue text-sm">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
