"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { PaperQuantity } from "@/components/job-cards/paper-quantity";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCommittedDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { releaseGangAction, type FormState } from "@/modules/job-cards/actions";
import { supplyByValues } from "@/modules/job-cards/validation";

import type { MachineOption } from "./job-card-form";

const initialState: FormState = { ok: false, error: null };

/**
 * The form's id, so the second-card confirmation can submit it.
 *
 * The dialog is portalled to the end of the document, which puts its button
 * outside the form in the DOM whatever the React tree says — the bug J17 found
 * on Stage Update, where a confirm button silently submitted nothing. Naming
 * the form is what keeps the click that confirms the click that submits.
 */
const FORM_ID = "gang-release";

const inputClass =
  "border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]";

export type GangItem = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  clientCode: string;
  clientName: string;
  pendingQty: number;
  committedDate: string | null;
};

function Submit({ label, form }: { label: string; form?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" form={form} disabled={pending}>
      {pending ? "Raising…" : label}
    </Button>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string | number | null;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        className={inputClass}
      />
    </label>
  );
}

/**
 * Raising several cards on one plate, in one submit (J20).
 *
 * WHAT THIS IS NOT: a job card covering several items. It writes one card per
 * item, each keeping its own number, committed date, stage history and OTD.
 * The plate is a `press_run` (H1), which is what "these go together" has meant
 * since ganging was built, and what they share lives on it (J15).
 *
 * The form has two halves for that reason. The plate is entered once. Per item
 * there is exactly one field — how many — because that is the only fact that
 * genuinely differs. Everything else a card can carry is left to the card,
 * deliberately: five items' worth of fabrication answers and checklists on one
 * screen would be worse than the five passes this replaces.
 */
export function GangReleaseForm({
  items,
  machines,
  today,
}: {
  items: GangItem[];
  machines: MachineOption[];
  /** IST, from the server — a date input seeded from a browser clock is wrong. */
  today: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(releaseGangAction, initialState);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state.needsSecondCardConfirmation) setConfirming(true);
  }, [state]);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  const clients = [...new Set(items.map((i) => i.clientCode))];

  return (
    <form id={FORM_ID} action={formAction} className="mt-6 space-y-8">
      {/* Answered once for the batch when the dialog asks (J3). */}
      <input type="hidden" name="confirmSecondCards" value={confirming ? "1" : ""} />

      {/* ------------------------------------------------------------------ */}
      {/* The jobs on the plate                                              */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h4 className="text-sm font-medium">
          {items.length} jobs on this plate
          {clients.length > 1 ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              · {clients.length} clients
            </span>
          ) : null}
        </h4>
        <p className="text-muted-foreground mt-1 text-[12px]">
          Each of these gets its own job card and its own number. They keep their own
          committed dates and move through stages separately — the plate is what they share,
          not a schedule.
        </p>

        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="data-grid w-full">
            <thead>
              <tr>
                <th className="px-3">Item</th>
                <th className="px-3">Client</th>
                <th className="px-3">Committed</th>
                <th className="px-3 text-right">To make</th>
                <th className="w-40 px-3">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.poItemId}>
                  {/* Positionally matched to plannedQty below — the parallel
                      arrays the schema checks the length of (F20). */}
                  <input type="hidden" name="poItemId" value={i.poItemId} />

                  <td className="px-3">
                    <span className="tabular-nums">{i.itemCode}</span>{" "}
                    <span className="text-muted-foreground">{i.itemName}</span>
                  </td>
                  <td className="px-3" title={i.clientName}>
                    {i.clientCode}
                  </td>
                  <td className="px-3">{formatCommittedDate(i.committedDate)}</td>
                  <td className="text-muted-foreground px-3 text-right tabular-nums">
                    {formatQty(i.pendingQty)}
                  </td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      name="plannedQty"
                      min={1}
                      inputMode="numeric"
                      placeholder={String(i.pendingQty)}
                      aria-label={`Quantity for ${i.itemCode}`}
                      className="border-input bg-background h-9 w-full rounded-md border px-2 text-[13px]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground mt-2 text-xs">
          Leave a quantity blank for all of what is still owed on that item.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The plate — entered once, shared by every job on it (J15)          */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h4 className="text-sm font-medium">The plate</h4>
        <p className="text-muted-foreground mt-1 text-[12px]">
          Entered once and shared by every job above. One plate is one trip through the
          press, so its date is the planned date for all of them.
        </p>

        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <Field name="runDate" label="Run date" type="date" defaultValue={today} />

          <label className="block">
            <span className="text-[13px] font-medium">Machine</span>
            <select name="machineId" defaultValue="" className={inputClass}>
              <option value="">Not decided yet</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.sheetSize ? ` — ${m.sheetSize}` : ""}
                </option>
              ))}
            </select>
          </label>

          <Field name="plateJobId" label="Plate / Job ID" />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field name="paperSize" label="Sheet size" placeholder={'25" x 36"'} />
          <Field name="paperGsm" label="GSM" placeholder="100" />
          <Field name="paperFinish" label="Matt / gloss" />
        </div>

        <PaperQuantity className="mt-4" />

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-[13px] font-medium">Paper supplied by</span>
            <select name="paperSupplyBy" defaultValue="" className={inputClass}>
              <option value="">Not decided yet</option>
              {supplyByValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[13px] font-medium">Plate supplied by</span>
            <select name="plateSupplyBy" defaultValue="" className={inputClass}>
              <option value="">Not decided yet</option>
              {supplyByValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <Field name="paperRemarks" label="Paper remarks" />
        </div>

        <div className="mt-4">
          <Field name="notes" label="Run notes" />
        </div>
      </section>

      {state.error ? (
        <p role="alert" className="text-overdue text-sm">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Submit label={`Raise ${items.length} cards on one plate`} />
        <span className="text-muted-foreground text-[12px]">
          {items.length} job cards and one press run, written together.
        </span>
      </div>

      <SecondCardConfirm
        open={confirming}
        onOpenChange={setConfirming}
        message={state.message ?? ""}
        formId={FORM_ID}
      />
    </form>
  );
}

/**
 * J3's second-card question, asked once for the batch.
 *
 * A repeat or split run is legitimate — spec section 3 says a PO item may have
 * several job cards — so this warns and never blocks. Asking once, naming every
 * item it applies to, is the point: five separate questions is the tedium this
 * screen exists to remove.
 *
 * The confirm button names its form, because the dialog is portalled outside it
 * (J17). The hidden `confirmSecondCards` field is already "1" by the time this
 * is visible, so the click that confirms is the click that submits.
 */
function SecondCardConfirm({
  open,
  onOpenChange,
  message,
  formId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  formId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Some of these already have a card</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <p className={cn("text-muted-foreground text-[13px]")}>
          A second card is how a split or a repeat run is recorded, so this is allowed. The
          first card is not touched.
        </p>

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Submit label="Raise them anyway" form={formId} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
