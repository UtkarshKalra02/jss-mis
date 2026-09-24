"use client";

import { useActionState, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { materialAdjustmentReasonEnum } from "@/db/schema/enums";
import { todayIST } from "@/lib/dates";
import { formatDate, formatQty } from "@/lib/format";
import { createAdjustmentAction, type FormState } from "@/modules/materials/actions";
import type { MaterialOption, OpenBatch } from "@/modules/materials/queries";

import { MaterialPicker } from "./material-picker";
import { Feedback, Submit, inputClass, useRedirectOnSuccess } from "./form-bits";

const initialState: FormState = { ok: false, error: null };

/**
 * A count correction, damage or return, against one batch (section O).
 * Signed: negative takes stock away. This is the ONLY way a count that has
 * drifted gets fixed — the issue guard sends people here on purpose.
 */
export function AdjustmentForm({
  materials,
  batches,
  presetMaterialId,
}: {
  materials: MaterialOption[];
  /** Every batch, including empty ones — a correction may put stock back into one. */
  batches: OpenBatch[];
  presetMaterialId?: string;
}) {
  const [state, formAction] = useActionState(createAdjustmentAction, initialState);
  useRedirectOnSuccess(state);
  const id = useId();
  const [materialId, setMaterialId] = useState(presetMaterialId ?? "");
  const forMaterial = batches.filter((b) => b.materialId === materialId);
  const chosen = materials.find((m) => m.id === materialId);

  return (
    <form action={formAction} className="space-y-6">
      <section className="rounded-lg border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-material`}>Material</Label>
            <MaterialPicker
              id={`${id}-material`}
              name="material"
              materials={materials}
              value={materialId}
              onChange={setMaterialId}
              label="Material"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-batch`}>Batch</Label>
            {!materialId ? (
              <p className="text-muted-foreground text-[13px]">Choose the material first.</p>
            ) : forMaterial.length === 0 ? (
              <p className="text-overdue text-[13px]">
                This material has no batches at all. Receive it first — an opening count is a
                receipt with no vendor.
              </p>
            ) : (
              <select id={`${id}-batch`} name="batchId" required defaultValue={forMaterial[0]!.batchId} className={inputClass}>
                {forMaterial.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.batchNo} · received {formatDate(b.receivedDate)} · {formatQty(b.qtyRemaining)}{" "}
                    {chosen?.unit} left
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-qty`}>Change{chosen ? ` (${chosen.unit})` : ""}</Label>
            <Input id={`${id}-qty`} name="qty" type="number" step="0.01" required className="text-right tabular-nums" placeholder="-10" />
            <p className="text-muted-foreground text-xs">Negative takes stock away; positive puts it back.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>Reason</Label>
            <select id={`${id}-reason`} name="reason" required defaultValue="Count correction" className={inputClass}>
              {materialAdjustmentReasonEnum.enumValues.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-date`}>Date</Label>
            <Input id={`${id}-date`} name="adjustedOn" type="date" required defaultValue={todayIST()} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-remarks`}>Remarks</Label>
            <Input id={`${id}-remarks`} name="remarks" placeholder="Physical check" />
          </div>
        </div>
      </section>

      <Feedback state={state} />
      <Submit label="Record adjustment" />
    </form>
  );
}
