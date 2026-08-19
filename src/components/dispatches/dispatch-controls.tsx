"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dispatchStatusEnum } from "@/db/schema/enums";
import { formatQty } from "@/lib/format";
import {
  addDispatchLineAction,
  removeDispatchLineAction,
  setDispatchCancelledAction,
  updateDispatchHeaderAction,
  type FormState,
} from "@/modules/dispatches/actions";
import type { DispatchableItem } from "@/modules/dispatches/queries";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

function Submit({
  label,
  variant,
}: {
  label: string;
  variant?: "outline" | "destructive" | "default";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-overdue mt-2 text-sm">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-on-time mt-2 text-sm">
        {state.message}
      </p>
    );
  }
  return null;
}

export function DispatchHeaderForm({
  head,
}: {
  head: {
    id: string;
    dispatchDate: string;
    status: string;
    vehicleNo: string | null;
    transporter: string | null;
    ewayBillNo: string | null;
    remarks: string | null;
  };
}) {
  const [state, formAction] = useActionState(updateDispatchHeaderAction, initialState);
  const formId = useId();

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="id" value={head.id} />
      <h2 className="text-sm font-medium">Challan details</h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-date`}>Dispatch date</Label>
          <Input
            id={`${formId}-date`}
            name="dispatchDate"
            type="date"
            required
            defaultValue={head.dispatchDate}
          />
          <p className="text-muted-foreground text-xs">
            Stage events already written keep their original date. A correction to history
            is a new event, never an edit to an old one.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-status`}>Status</Label>
          <select
            id={`${formId}-status`}
            name="status"
            defaultValue={head.status}
            className={inputClass}
          >
            {dispatchStatusEnum.enumValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-vehicle`}>Vehicle no</Label>
          <Input id={`${formId}-vehicle`} name="vehicleNo" defaultValue={head.vehicleNo ?? ""} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-transporter`}>Transporter</Label>
          <Input
            id={`${formId}-transporter`}
            name="transporter"
            defaultValue={head.transporter ?? ""}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-eway`}>E-way bill no</Label>
          <Input
            id={`${formId}-eway`}
            name="ewayBillNo"
            defaultValue={head.ewayBillNo ?? ""}
            className="tabular-nums"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-remarks`}>Remarks</Label>
          <Input id={`${formId}-remarks`} name="remarks" defaultValue={head.remarks ?? ""} />
        </div>
      </div>

      <div className="mt-4">
        <Submit label="Save details" variant="outline" />
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** Adds one more item to an existing challan. */
export function AddDispatchLine({
  dispatchId,
  candidates,
}: {
  dispatchId: string;
  candidates: DispatchableItem[];
}) {
  const [state, formAction] = useActionState(addDispatchLineAction, initialState);
  const formId = useId();
  const [poItemId, setPoItemId] = useState("");

  const selected = candidates.find((c) => c.poItemId === poItemId);

  if (candidates.length === 0) {
    return (
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Add an item</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Nothing else is pending for this client.
        </p>
      </section>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="dispatchId" value={dispatchId} />
      <h2 className="text-sm font-medium">Add an item</h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${formId}-item`}>Item</Label>
          <select
            id={`${formId}-item`}
            name="poItemId"
            required
            value={poItemId}
            onChange={(e) => setPoItemId(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Choose an item…
            </option>
            {candidates.map((c) => (
              <option key={c.poItemId} value={c.poItemId}>
                {c.itemCode} — {c.itemName} ({formatQty(c.pendingQty)} pending
                {c.currentStage !== "READY" ? ", not ready" : ""})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-qty`}>Quantity</Label>
          <Input
            id={`${formId}-qty`}
            name="qty"
            type="number"
            min={1}
            step={1}
            required
            // Defaults to the whole remainder, like the capture form.
            key={poItemId}
            defaultValue={selected?.pendingQty ?? ""}
            className="text-right tabular-nums"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-rate`}>Rate (₹)</Label>
          <Input
            id={`${formId}-rate`}
            name="rate"
            type="number"
            min={0}
            step="0.01"
            key={`rate-${poItemId}`}
            defaultValue={selected?.rate ?? ""}
            className="text-right tabular-nums"
          />
        </div>
      </div>

      <div className="mt-4">
        <Submit label="Add line" variant="outline" />
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function RemoveDispatchLine({
  lineId,
  dispatchId,
  itemCode,
}: {
  lineId: string;
  dispatchId: string;
  itemCode: string;
}) {
  const [state, formAction] = useActionState(removeDispatchLineAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={lineId} />
      <input type="hidden" name="dispatchId" value={dispatchId} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:text-overdue h-7 px-2 text-[11px]"
        aria-label={`Remove ${itemCode} from this challan`}
      >
        Remove
      </Button>
      {state.error ? (
        <span role="alert" className="text-overdue ml-2 text-[11px]">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function DispatchCancelControl({
  dispatchId,
  challanNo,
  status,
}: {
  dispatchId: string;
  challanNo: string;
  status: string;
}) {
  const [state, formAction] = useActionState(setDispatchCancelledAction, initialState);
  const cancelled = status === "Cancelled";

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">
        {cancelled ? "Reinstate challan" : "Cancel challan"}
      </h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {cancelled
          ? `${challanNo} counts against the order again, and its items go back to being delivered.`
          : `${challanNo} stops consuming order quantity — every item on it is owed again. The challan and its lines stay, marked cancelled, and the DISPATCHED stage events it wrote remain in the timeline because they happened.`}
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={dispatchId} />
        <input type="hidden" name="cancel" value={cancelled ? "false" : "true"} />
        <Submit label={cancelled ? "Reinstate" : "Cancel challan"} variant="outline" />
      </form>
      <Feedback state={state} />
    </section>
  );
}
