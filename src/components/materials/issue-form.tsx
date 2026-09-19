"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayIST } from "@/lib/dates";
import { formatDate, formatQty } from "@/lib/format";
import { createIssueAction, type FormState } from "@/modules/materials/actions";
import type { MaterialOption, OpenBatch } from "@/modules/materials/queries";

import { Feedback, Submit, inputClass, useRedirectOnSuccess } from "./form-bits";

const initialState: FormState = { ok: false, error: null };

export type IssuePreset = {
  materialId?: string;
  qty?: string;
  jobCardId?: string;
  jcNo?: string;
  department?: string;
};

/**
 * Material leaving the store (section O).
 *
 * Choose the material, then the batch — OLDEST FIRST, preselected, so the
 * default is the FIFO one and picking another is a decision (O3). What the
 * batch has left is shown beside it; the database refuses more than that.
 *
 * Arrives pre-filled from a job card's page: the paper the card names, the
 * parent-sheet count from paperCount() (J18's "what left the godown"), and
 * the card itself. Nothing moves until this form is submitted — that is the
 * whole of "manually for now".
 */
export function IssueForm({
  materials,
  batches,
  preset = {},
}: {
  materials: MaterialOption[];
  batches: OpenBatch[];
  preset?: IssuePreset;
}) {
  const [state, formAction] = useActionState(createIssueAction, initialState);
  useRedirectOnSuccess(state);
  const id = useId();

  const [materialId, setMaterialId] = useState(preset.materialId ?? "");
  const forMaterial = batches.filter((b) => b.materialId === materialId);
  const [batchId, setBatchId] = useState(forMaterial[0]?.batchId ?? "");

  const chosen = materials.find((m) => m.id === materialId);
  const batch = forMaterial.find((b) => b.batchId === batchId) ?? forMaterial[0];

  const pickMaterial = (next: string) => {
    setMaterialId(next);
    setBatchId(batches.find((b) => b.materialId === next)?.batchId ?? "");
  };

  return (
    <form action={formAction} className="space-y-6">
      {preset.jobCardId ? (
        <>
          <input type="hidden" name="jobCardId" value={preset.jobCardId} />
          <p className="bg-neutral-status-bg rounded-lg px-3 py-2 text-[13px]">
            Against job card{" "}
            <Link href={`/job-cards/${preset.jobCardId}`} className="text-primary tabular-nums hover:underline">
              {preset.jcNo ?? preset.jobCardId}
            </Link>
            . The quantity below is the parent-sheet count from the card; change it if the
            store gave more or less.
          </p>
        </>
      ) : (
        <input type="hidden" name="jobCardId" value="" />
      )}

      <section className="rounded-lg border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-material`}>Material</Label>
            <select
              id={`${id}-material`}
              name="material"
              required
              value={materialId}
              onChange={(e) => pickMaterial(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Choose…
              </option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.sku} — {m.name} ({formatQty(m.closingStock)} {m.unit} in stock)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-batch`}>From batch</Label>
            {!materialId ? (
              <p className="text-muted-foreground text-[13px]">Choose the material first.</p>
            ) : forMaterial.length === 0 ? (
              <p className="text-overdue text-[13px]">
                Nothing left in any batch of this material. Receive some, or adjust a batch if
                the count is wrong.
              </p>
            ) : (
              <select
                id={`${id}-batch`}
                name="batchId"
                required
                value={batch?.batchId ?? ""}
                onChange={(e) => setBatchId(e.target.value)}
                className={inputClass}
              >
                {forMaterial.map((b, i) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.batchNo} · received {formatDate(b.receivedDate)} · {formatQty(b.qtyRemaining)}{" "}
                    {chosen?.unit} left{i === 0 ? " · oldest" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-qty`}>Quantity{chosen ? ` (${chosen.unit})` : ""}</Label>
            <Input
              id={`${id}-qty`}
              name="qty"
              type="number"
              min={0.01}
              step="0.01"
              required
              defaultValue={preset.qty ?? ""}
              className="text-right tabular-nums"
            />
            {batch ? (
              <p className="text-muted-foreground text-xs">
                {formatQty(batch.qtyRemaining)} {chosen?.unit} left in {batch.batchNo}.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-date`}>Issued on</Label>
            <Input id={`${id}-date`} name="issuedOn" type="date" required defaultValue={todayIST()} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-dept`}>To</Label>
            <Input
              id={`${id}-dept`}
              name="department"
              defaultValue={preset.department ?? ""}
              placeholder="Offset Printing"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-remarks`}>Remarks</Label>
            <Input id={`${id}-remarks`} name="remarks" />
          </div>
        </div>
      </section>

      <Feedback state={state} />
      <Submit label="Record issue" />
    </form>
  );
}
