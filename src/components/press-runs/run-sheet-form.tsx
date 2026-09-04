"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type { MachineOption } from "@/components/job-cards/job-card-form";
import { PaperQuantity } from "@/components/job-cards/paper-quantity";
import {
  updateRunExecutionAction,
  updateRunSheetAction,
  type FormState,
} from "@/modules/press-runs/actions";
import type { PressRunRow } from "@/modules/press-runs/queries";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-overdue mt-2 text-[13px]">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-on-time mt-2 text-[13px]">
        {state.message}
      </p>
    );
  }
  return null;
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: string;
  placeholder?: string;
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

function SupplySelect({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
        <option value="">Not decided yet</option>
        <option value="Press">Press</option>
        <option value="Party">Party</option>
      </select>
    </label>
  );
}

/**
 * The sheet every job on this plate shares — entered once (J15).
 *
 * These are the same fields a standalone job card carries. They are here
 * because a ganged run has ONE parent sheet, one plate and one supply
 * arrangement, and holding them per card would let two cards on one plate
 * disagree about what they are printing on.
 *
 * While a card is on this run, these values WIN over the card's own. The card
 * screen says so and stops offering the inputs, so there is one place to type
 * them and one place to read them.
 */
export function RunSheetForm({
  run,
  machines,
}: {
  run: PressRunRow;
  machines: MachineOption[];
}) {
  const [state, formAction] = useActionState(updateRunSheetAction, initialState);

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="id" value={run.id} />

      <h2 className="text-sm font-medium">The sheet</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Shared by every job on this plate, and printed once. While a card is on this run,
        these override whatever the card itself carries.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field name="runDate" label="Run date" type="date" defaultValue={run.runDate} />

        <label className="block">
          <span className="text-[13px] font-medium">Machine</span>
          <select name="machineId" defaultValue={run.machineId ?? ""} className={inputClass}>
            <option value="">Not decided yet</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.sheetSize ? ` — ${m.sheetSize}` : ""}
              </option>
            ))}
          </select>
          {/* The original free-text machine from H1, shown only where a row
              predates the machine list so the note is not silently lost. */}
          {!run.machineId && run.machine ? (
            <span className="text-muted-foreground mt-1 block text-[12px]">
              Previously noted as &ldquo;{run.machine}&rdquo;.
            </span>
          ) : null}
        </label>

        <Field name="plateJobId" label="Plate / Job ID" defaultValue={run.plateJobId} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field name="paperSize" label="Sheet size" placeholder={'25" x 36"'} defaultValue={run.paperSize} />
        <Field name="paperGsm" label="GSM" placeholder="100" defaultValue={run.paperGsm} />
        <Field name="paperFinish" label="Matt / gloss" defaultValue={run.paperFinish} />
      </div>

      {/* The same control the job card uses, so the plate and the cards on it
          cannot disagree about the arithmetic (J18). */}
      <PaperQuantity
        className="mt-4"
        qty={run.paperQty}
        bundle={run.paperBundle}
        parts={run.paperParts}
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <SupplySelect
          name="paperSupplyBy"
          label="Paper supplied by"
          defaultValue={run.paperSupplyBy}
        />
        <SupplySelect
          name="plateSupplyBy"
          label="Plate supplied by"
          defaultValue={run.plateSupplyBy}
        />
        <Field name="paperRemarks" label="Paper remarks" defaultValue={run.paperRemarks} />
      </div>

      <label className="mt-4 block">
        <span className="text-[13px] font-medium">Notes for the floor</span>
        <textarea
          name="notes"
          rows={2}
          maxLength={500}
          defaultValue={run.notes ?? ""}
          className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
        />
      </label>

      <div className="mt-4">
        <Submit label="Save the sheet" />
        <Feedback state={state} />
      </div>
    </form>
  );
}

/**
 * What came off the plate — one set of figures for the whole run.
 *
 * Separate action from the sheet above, on J6's reasoning: somebody typing a
 * wastage figure a week later must not post a stale copy of the paper spec
 * back over a correction.
 *
 * The per-client split lives in the remark rather than in its own fields. The
 * press produced a number of sheets; how that divides between the clients on
 * it is a question that often does not need answering, and inventing a
 * split-quantity workflow nobody has asked to maintain is how a feature grows
 * a form (J15).
 */
export function RunExecutionForm({ run }: { run: PressRunRow }) {
  const [state, formAction] = useActionState(updateRunExecutionAction, initialState);
  const recorded = run.finalQty !== null || run.wastageQty !== null;

  return (
    <form action={formAction} className="rounded-lg border p-4">
      <input type="hidden" name="id" value={run.id} />

      <h2 className="text-sm font-medium">After the run</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {recorded
          ? "Transcribed from the printed run sheet."
          : "Blank until somebody copies these off the printed sheet. It goes to the floor without them — the numbers do not exist yet."}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          name="finalQty"
          label="Final quantity (whole sheet)"
          type="number"
          defaultValue={run.finalQty}
        />
        <Field name="wastageQty" label="Wastage" type="number" defaultValue={run.wastageQty} />
      </div>

      <label className="mt-4 block">
        <span className="text-[13px] font-medium">Remarks</span>
        <textarea
          name="executionRemarks"
          rows={3}
          maxLength={2000}
          defaultValue={run.executionRemarks ?? ""}
          placeholder="Including the per-client split, where the count needed dividing."
          className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
        />
      </label>

      <div className="mt-4">
        <Submit label="Save run figures" />
        <Feedback state={state} />
      </div>
    </form>
  );
}
