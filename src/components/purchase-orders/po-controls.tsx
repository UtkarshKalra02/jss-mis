"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { jobTypeEnum, priorityEnum } from "@/db/schema/enums";
import type { ClientOption } from "@/modules/designs/queries";
import {
  addPoItemAction,
  removePoItemAction,
  setPoItemCancelledAction,
  setPurchaseOrderCancelledAction,
  updatePoHeaderAction,
  updatePoItemAction,
  type FormState,
} from "@/modules/purchase-orders/actions";
import type { DesignOption } from "@/modules/purchase-orders/queries";

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
  if (state.warning) {
    return (
      <div role="alert" className="border-at-risk/40 bg-at-risk-bg mt-2 rounded-lg border p-3">
        <p className="text-sm">{state.warning}</p>
        <Button
          type="submit"
          name="confirmDuplicate"
          value="true"
          size="sm"
          variant="outline"
          className="mt-2"
        >
          Save anyway
        </Button>
      </div>
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

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

export function PoHeaderForm({
  po,
  clients,
}: {
  po: {
    id: string;
    clientId: string;
    poNo: string | null;
    poDate: string;
    fileUrl: string | null;
    notes: string | null;
  };
  clients: ClientOption[];
}) {
  const [state, formAction] = useActionState(updatePoHeaderAction, initialState);
  const formId = useId();

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="id" value={po.id} />
      <h2 className="text-sm font-medium">Header</h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-client`}>Client</Label>
          <select
            id={`${formId}-client`}
            name="clientId"
            required
            defaultValue={po.clientId}
            className={inputClass}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
                {c.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-poNo`}>Client&rsquo;s PO number</Label>
          <Input id={`${formId}-poNo`} name="poNo" defaultValue={po.poNo ?? ""} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-poDate`}>PO date</Label>
          <Input
            id={`${formId}-poDate`}
            name="poDate"
            type="date"
            required
            defaultValue={po.poDate}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-fileUrl`}>Scanned PO</Label>
          <Input
            id={`${formId}-fileUrl`}
            name="fileUrl"
            type="url"
            defaultValue={po.fileUrl ?? ""}
            placeholder="https://drive.google.com/…"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${formId}-notes`}>Notes</Label>
          <Input id={`${formId}-notes`} name="notes" defaultValue={po.notes ?? ""} />
        </div>
      </div>

      <div className="mt-4">
        <Submit label="Save header" variant="outline" />
      </div>
      <Feedback state={state} />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Item form — shared by "add" and "edit"                                      */
/* -------------------------------------------------------------------------- */

type ItemValues = {
  id?: string;
  itemName?: string;
  orderedQty?: number;
  rate?: string | null;
  committedDate?: string | null;
  jobType?: string;
  priority?: string;
  designId?: string | null;
  remarks?: string | null;
};

/**
 * One item, added or edited.
 *
 * Committed date is `required` here exactly as it is on the capture form. The
 * column is nullable only so the historical importer can be honest (F8); every
 * human entry point demands one, and this is one.
 */
export function PoItemForm({
  mode,
  purchaseOrderId,
  item,
  designs,
}: {
  mode: "add" | "edit";
  purchaseOrderId: string;
  item?: ItemValues;
  designs: DesignOption[];
}) {
  const [state, formAction] = useActionState(
    mode === "add" ? addPoItemAction : updatePoItemAction,
    initialState,
  );
  const formId = useId();

  return (
    <form action={formAction} className="rounded-lg border p-4">
      {mode === "add" ? (
        <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      ) : (
        <input type="hidden" name="id" value={item!.id} />
      )}

      <h2 className="text-sm font-medium">{mode === "add" ? "Add an item" : "Item"}</h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${formId}-name`}>Item name</Label>
          <Input
            id={`${formId}-name`}
            name="itemName"
            required
            defaultValue={item?.itemName ?? ""}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-design`}>Design</Label>
          <select
            id={`${formId}-design`}
            name="designId"
            defaultValue={item?.designId ?? ""}
            className={inputClass}
          >
            <option value="">— none —</option>
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.designCode} — {d.jobName}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-qty`}>Ordered quantity</Label>
          <Input
            id={`${formId}-qty`}
            name="orderedQty"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={item?.orderedQty ?? ""}
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
            defaultValue={item?.rate ?? ""}
            className="text-right tabular-nums"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-committed`}>Committed date</Label>
          <Input
            id={`${formId}-committed`}
            name="committedDate"
            type="date"
            required
            defaultValue={item?.committedDate ?? ""}
          />
          <p className="text-muted-foreground text-xs">
            OTD is measured against this. Required on every item.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-jobType`}>Job type</Label>
          <select
            id={`${formId}-jobType`}
            name="jobType"
            defaultValue={item?.jobType ?? "New"}
            className={inputClass}
          >
            {jobTypeEnum.enumValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Describes this job, not the client. A repeat client still places new jobs.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-priority`}>Priority</Label>
          <select
            id={`${formId}-priority`}
            name="priority"
            defaultValue={item?.priority ?? "Normal"}
            className={inputClass}
          >
            {priorityEnum.enumValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${formId}-remarks`}>Remarks</Label>
          <Input id={`${formId}-remarks`} name="remarks" defaultValue={item?.remarks ?? ""} />
        </div>
      </div>

      <div className="mt-4">
        <Submit label={mode === "add" ? "Add item" : "Save item"} variant="outline" />
      </div>
      <Feedback state={state} />
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Cancel / remove                                                             */
/* -------------------------------------------------------------------------- */

export function PoItemControls({
  itemId,
  itemCode,
  status,
  dispatchedQty,
}: {
  itemId: string;
  itemCode: string;
  status: string;
  dispatchedQty: number;
}) {
  const [cancelState, cancelAction] = useActionState(setPoItemCancelledAction, initialState);
  const [removeState, removeAction] = useActionState(removePoItemAction, initialState);

  const cancelled = status === "Cancelled";

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">{cancelled ? "Reinstate item" : "Cancel item"}</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {cancelled
            ? `${itemCode} goes back to being live work. Its status settles on whatever the dispatched quantity says, so a fully delivered item returns as closed rather than open.`
            : `${itemCode} stops counting as work owed. Its history, stage events and any dispatches stay exactly as they are.`}
        </p>

        <form action={cancelAction} className="mt-3">
          <input type="hidden" name="id" value={itemId} />
          <input type="hidden" name="cancel" value={cancelled ? "false" : "true"} />
          <Submit label={cancelled ? "Reinstate" : "Cancel item"} variant="outline" />
        </form>
        <Feedback state={cancelState} />
      </section>

      <section className="border-overdue/30 rounded-lg border p-4">
        <h2 className="text-sm font-medium">Remove item</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {dispatchedQty > 0
            ? `${itemCode} has ${dispatchedQty} dispatched against it, so it cannot be removed — the challans would still say it went out. Cancel it instead.`
            : "For an item entered by mistake. Cancelling is what you want if the order was real and then dropped."}
        </p>

        {dispatchedQty === 0 ? (
          <form action={removeAction} className="mt-3">
            <input type="hidden" name="id" value={itemId} />
            <Submit label="Remove" variant="destructive" />
          </form>
        ) : null}
        <Feedback state={removeState} />
      </section>
    </div>
  );
}

export function PurchaseOrderControls({
  poId,
  internalNo,
  status,
}: {
  poId: string;
  internalNo: string;
  status: string;
}) {
  const [state, formAction] = useActionState(setPurchaseOrderCancelledAction, initialState);
  const cancelled = status === "Cancelled";

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">
        {cancelled ? "Reinstate purchase order" : "Cancel purchase order"}
      </h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {cancelled
          ? `${internalNo} and its cancelled items go back to being live. Each item settles on its derived status.`
          : `${internalNo} and every open item on it are cancelled together. Items already delivered are left alone — that happened, and cancelling the order does not unhappen it.`}
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={poId} />
        <input type="hidden" name="cancel" value={cancelled ? "false" : "true"} />
        <Submit label={cancelled ? "Reinstate" : "Cancel PO"} variant="outline" />
      </form>
      <Feedback state={state} />
    </section>
  );
}
