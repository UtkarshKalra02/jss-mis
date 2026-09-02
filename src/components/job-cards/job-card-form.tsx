"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  releaseJobCardAction,
  updateJobCardPlanAction,
  type FormState,
} from "@/modules/job-cards/actions";
import { supplyByValues } from "@/modules/job-cards/validation";
import type { FabricationOptionRow, Selection } from "@/modules/fabrication/queries";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]";

export type MachineOption = { id: string; name: string; sheetSize: string | null };

export type JobCardPlanValues = {
  id?: string;
  plannedQty?: number | null;
  plannedDate?: string | null;
  paperSupplyBy?: string | null;
  plateSupplyBy?: string | null;
  plateJobId?: string | null;
  machineId?: string | null;
  checklistPaper?: boolean;
  checklistPlates?: boolean;
  checklistColour?: boolean;
  paperSize?: string | null;
  paperGsm?: string | null;
  paperFinish?: string | null;
  sheetsPerReam?: number | null;
  paperRemarks?: string | null;
  execNoOfColours?: string | null;
  execSize?: string | null;
  execPlanning?: string | null;
  fabricationRemarks?: string | null;
  notes?: string | null;
};

function Submit({ label, name, value }: { label: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} disabled={pending} size="sm">
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Field({
  name,
  label,
  hint,
  type = "text",
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  hint?: string;
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
      {hint ? <span className="text-muted-foreground mt-1 block text-[12px]">{hint}</span> : null}
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
  defaultValue?: string | null;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
        {/* Blank is the honest default. Neither is a safe guess, and whichever
            was picked would be PRINTED on the sheet the floor works from as
            though somebody had decided it. */}
        <option value="">Not decided yet</option>
        {supplyByValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The job card as somebody types it — the pen-written half of the paper form.
 *
 * ONE FORM FOR RELEASE AND FOR CORRECTION. A card is a document typed before
 * it is printed, and a typo in the sheet size must not mean removing the card
 * and releasing another, which would burn a JC number for a corrected
 * sentence. The only difference between the modes is the item, which is fixed
 * on an existing card (H1), and the second-card question, asked once.
 *
 * FINAL QUANTITY AND WASTAGE ARE NOT HERE. They belong to the transcription
 * form on the card's own screen, because they are written on the sheet after
 * the run and typing them back is a different act by a different person at a
 * different time (J4, J6).
 */
export function JobCardForm({
  mode,
  poItemId,
  itemCode,
  pendingQty,
  card,
  machines,
  runOptions,
  runSelected,
  hasExistingCard,
}: {
  mode: "release" | "edit";
  poItemId?: string;
  itemCode: string;
  pendingQty?: number;
  card?: JobCardPlanValues;
  machines: MachineOption[];
  /** Run-scope fabrication options this design has — new die or old, etc. */
  runOptions: FabricationOptionRow[];
  runSelected: Map<string, Selection>;
  hasExistingCard?: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    mode === "release" ? releaseJobCardAction : updateJobCardPlanAction,
    initialState,
  );
  const [open, setOpen] = useState(mode === "edit");
  const [runValues, setRunValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(runOptions.map((o) => [o.id, runSelected.get(o.id)?.valueId ?? ""])),
  );

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state.ok, state.redirectTo, router]);

  if (!open) {
    return (
      <div className="mt-4">
        <Button
          size="sm"
          variant={hasExistingCard ? "outline" : "default"}
          onClick={() => setOpen(true)}
        >
          {hasExistingCard ? "Release another card" : "Release to production"}
        </Button>
        {hasExistingCard ? (
          <p className="text-muted-foreground mt-1.5 text-[12px]">
            A second card is for a split or repeat run. One card still covers one item.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className={mode === "release" ? "bg-muted/30 mt-4 rounded-lg border p-4" : "space-y-6"}
    >
      {mode === "release" ? (
        <input type="hidden" name="poItemId" value={poItemId} />
      ) : (
        <input type="hidden" name="id" value={card!.id} />
      )}

      {mode === "release" ? (
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Release {itemCode} to production</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground text-[12px] hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className={mode === "release" ? "space-y-6" : "space-y-6"}>
        {/* ---------------------------------------------------------------- */}
        {/* Check list — the paper card's top-left corner                     */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <h4 className="text-sm font-medium">Check list</h4>
          <p className="text-muted-foreground mt-1 text-[12px]">
            Recorded, not enforced. Nothing refuses to print a card with these clear — the
            paper form never did either.
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            {(
              [
                ["checklistPaper", "Paper", card?.checklistPaper],
                ["checklistPlates", "Plates", card?.checklistPlates],
                ["checklistColour", "Colour", card?.checklistColour],
              ] as const
            ).map(([name, label, checked]) => (
              <label key={name} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={checked ?? false}
                  className="accent-primary size-4"
                />
                <span className="text-[13px]">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Supply, machine, quantity                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Field
            name="plannedQty"
            label="Quantity to run"
            type="number"
            defaultValue={card?.plannedQty ?? pendingQty}
            hint={
              mode === "release"
                ? "Defaults to what is still owed. Lower it for a split run."
                : undefined
            }
          />
          <Field
            name="plannedDate"
            label="Planned date"
            type="date"
            defaultValue={card?.plannedDate}
          />

          <SupplySelect
            name="paperSupplyBy"
            label="Paper supplied by"
            defaultValue={card?.paperSupplyBy}
          />
          <SupplySelect
            name="plateSupplyBy"
            label="Plate supplied by"
            defaultValue={card?.plateSupplyBy}
          />

          <Field
            name="plateJobId"
            label="Plate / Job ID"
            placeholder="As the platemaker gave it"
            defaultValue={card?.plateJobId}
          />

          {/* A tick list, because the press master exists — it has been on the
              paper card all along (J10). */}
          <label className="block">
            <span className="text-[13px] font-medium">Machine</span>
            <select name="machineId" defaultValue={card?.machineId ?? ""} className={inputClass}>
              <option value="">Not decided yet</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.sheetSize ? ` — ${m.sheetSize}` : ""}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Paper detail — the PARENT SHEET, not the finished size            */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <h4 className="text-sm font-medium">Paper detail</h4>
          <p className="text-muted-foreground mt-1 text-[12px]">
            The parent sheet this run prints on, not the finished size of the job. Typed per
            card, because it is a decision made out of whatever stock is in the building.
          </p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <Field
              name="paperSize"
              label="Size"
              placeholder={'25" x 36"'}
              defaultValue={card?.paperSize}
            />
            <Field name="paperGsm" label="GSM" placeholder="100" defaultValue={card?.paperGsm} />
            <Field
              name="paperFinish"
              label="Matt / gloss"
              defaultValue={card?.paperFinish}
            />
            <Field
              name="sheetsPerReam"
              label="Sheets / ream"
              type="number"
              defaultValue={card?.sheetsPerReam}
            />
            <div className="sm:col-span-2">
              <Field name="paperRemarks" label="Remarks" defaultValue={card?.paperRemarks} />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Job execution — everything except what the floor writes           */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <h4 className="text-sm font-medium">Job execution</h4>
          <p className="text-muted-foreground mt-1 text-[12px]">
            Printed on the card. Final quantity, wastage and the run remark are the only
            things left blank on the page.
          </p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <Field
              name="execNoOfColours"
              label="No. of colours"
              placeholder="4/c"
              defaultValue={card?.execNoOfColours}
            />
            <Field name="execSize" label="Size" defaultValue={card?.execSize} />
            <Field name="execPlanning" label="Planning" defaultValue={card?.execPlanning} />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Run-scope fabrication answers                                     */}
        {/* ---------------------------------------------------------------- */}
        {runOptions.length > 0 ? (
          <section>
            <h4 className="text-sm font-medium">This run</h4>
            <p className="text-muted-foreground mt-1 text-[12px]">
              The design says this job has these. Whether the tooling is new or old is a fact
              about THIS run, so it is asked here rather than on the design.
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              {runOptions.map((option) => (
                <label key={option.id} className="block">
                  <span className="text-[13px] font-medium">{option.label}</span>
                  <input type="hidden" name="fabricationOptionId" value={option.id} />
                  <select
                    name="fabricationValueId"
                    value={runValues[option.id] ?? ""}
                    onChange={(e) =>
                      setRunValues((v) => ({ ...v, [option.id]: e.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="">Not answered yet</option>
                    {option.values.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.value}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4">
          <label className="block">
            <span className="text-[13px] font-medium">Fabrication remarks</span>
            <textarea
              name="fabricationRemarks"
              rows={2}
              maxLength={1000}
              defaultValue={card?.fabricationRemarks ?? ""}
              className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
            />
          </label>

          <label className="block">
            <span className="text-[13px] font-medium">Notes for the floor</span>
            <textarea
              name="notes"
              rows={2}
              maxLength={1000}
              defaultValue={card?.notes ?? ""}
              className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
            />
          </label>
        </section>
      </div>

      {/* The second-card question (J3), riding on the BUTTON's own name/value
          rather than a state-driven hidden input: a click submits before React
          re-renders, so a state flag would arrive one submit late (F20). */}
      {state.needsSecondCardConfirmation ? (
        <div className="bg-at-risk-bg mt-4 rounded-md px-3 py-2.5">
          <p className="text-at-risk text-[13px] font-medium">{state.message}</p>
          <p className="text-muted-foreground mt-1 text-[12px]">
            This is allowed — a PO item may have several cards for split and repeat runs.
            Each card still covers this one item.
          </p>
          <div className="mt-3">
            <Submit label="Release anyway" name="confirmSecondCard" value="1" />
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <Submit label={mode === "release" ? "Release" : "Save"} />
          {state.error ? (
            <p role="alert" className="text-overdue text-[13px]">
              {state.error}
            </p>
          ) : null}
          {state.ok && state.message ? (
            <p role="status" className="text-on-time text-[13px]">
              {state.message}
            </p>
          ) : null}
        </div>
      )}
    </form>
  );
}
