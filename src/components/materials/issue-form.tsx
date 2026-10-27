"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayIST } from "@/lib/dates";
import { formatDate, formatQty } from "@/lib/format";
import { createIssueAction, type FormState } from "@/modules/materials/actions";
import type { MaterialOption, OpenBatch } from "@/modules/materials/queries";

import { MaterialPicker } from "./material-picker";
import { Feedback, Submit, inputClass, useRedirectOnSuccess } from "./form-bits";

const initialState: FormState = { ok: false, error: null };

import type { IssuePreset } from "@/modules/materials/issue-preset";

export type { IssuePreset };

const sameJob = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/**
 * Material leaving the store (section O).
 *
 * Choose the material, then the batch — the JOB'S OWN paper first when the
 * job is named (P3), then oldest first, preselected, so the default is the
 * right one and picking another is a decision (O3). Taking another job's
 * reserved paper is allowed and said so beside the batch, the way the sheet
 * warned. What the batch has left is shown; the database refuses more.
 *
 * Arrives pre-filled from a job card's page: the paper the card names, the
 * parent-sheet count from paperCount() (J18's "what left the godown"), and
 * the card itself. Nothing moves until this form is submitted — that is the
 * whole of "manually for now".
 */
export function IssueForm({
  materials,
  batches,
  departments,
  preset = {},
}: {
  materials: MaterialOption[];
  batches: OpenBatch[];
  /** Where issues have gone before, most used first — a picklist, not a rule. */
  departments: string[];
  preset?: IssuePreset;
}) {
  const [state, formAction] = useActionState(createIssueAction, initialState);
  useRedirectOnSuccess(state);
  const id = useId();

  const [materialId, setMaterialId] = useState(preset.materialId ?? "");

  /*
   * Issuing in bundles (V1), the same shape as the receipt: typing both fills
   * the quantity, because the ledger stores sheets and the two must not be
   * able to disagree. Blank for loose, and the quantity is typed as before.
   */
  const [bundles, setBundles] = useState("");
  const [perBundle, setPerBundle] = useState("");
  const [qty, setQty] = useState(preset.qty ?? "");

  const bothBundles =
    bundles !== "" && perBundle !== "" && Number(bundles) > 0 && Number(perBundle) > 0;

  const setBundleField = (which: "b" | "p", value: string) => {
    const b = which === "b" ? value : bundles;
    const per = which === "p" ? value : perBundle;
    if (which === "b") setBundles(value);
    else setPerBundle(value);
    if (b !== "" && per !== "" && Number(b) > 0 && Number(per) > 0) {
      setQty(String(Number(b) * Number(per)));
    }
  };
  const [jobRef, setJobRef] = useState(preset.jobRef ?? "");

  /* The job's own paper first, then unreserved oldest-first, then other jobs'. */
  const order = (list: OpenBatch[]) =>
    [...list].sort((a, b) => {
      const rank = (x: OpenBatch) => (sameJob(x.jobRef, jobRef) ? 0 : x.jobRef ? 2 : 1);
      return rank(a) - rank(b) || (a.receivedDate < b.receivedDate ? -1 : a.receivedDate > b.receivedDate ? 1 : 0);
    });
  const forMaterial = order(batches.filter((b) => b.materialId === materialId));
  const [batchId, setBatchId] = useState(forMaterial[0]?.batchId ?? "");

  const chosen = materials.find((m) => m.id === materialId);
  const batch = forMaterial.find((b) => b.batchId === batchId) ?? forMaterial[0];
  const otherJob = batch?.jobRef && !sameJob(batch.jobRef, jobRef) ? batch.jobRef : null;

  const pickMaterial = (next: string) => {
    setMaterialId(next);
    setBatchId(order(batches.filter((b) => b.materialId === next))[0]?.batchId ?? "");
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
            <MaterialPicker
              id={`${id}-material`}
              name="material"
              materials={materials}
              value={materialId}
              onChange={pickMaterial}
              label="Material"
            />
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
                {forMaterial.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.batchNo} · {formatDate(b.receivedDate)} · {formatQty(b.qtyRemaining)}{" "}
                    {chosen?.unit} left
                    {b.jobRef ? (sameJob(b.jobRef, jobRef) ? " · this job's" : ` · for ${b.jobRef}`) : ""}
                  </option>
                ))}
              </select>
            )}
            {otherJob ? (
              <p className="text-at-risk text-xs">
                This batch was bought for &ldquo;{otherJob}&rdquo;. You can still issue from it; the
                issue will say so.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-bundles`}>Bundles × sheets</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${id}-bundles`}
                name="bundles"
                type="number"
                min={1}
                step="1"
                inputMode="numeric"
                placeholder="5"
                value={bundles}
                onChange={(e) => setBundleField("b", e.target.value)}
                className="text-right tabular-nums"
              />
              <span className="text-muted-foreground text-xs">×</span>
              <Input
                name="sheetsPerBundle"
                type="number"
                min={1}
                step="1"
                inputMode="numeric"
                placeholder="460"
                value={perBundle}
                onChange={(e) => setBundleField("p", e.target.value)}
                className="text-right tabular-nums"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Leave blank for loose stock and type the quantity instead.
            </p>
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
              readOnly={bothBundles}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`text-right tabular-nums ${bothBundles ? "bg-muted/50" : ""}`}
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
              list={`${id}-depts`}
              defaultValue={preset.department ?? ""}
              placeholder="Offset Printing"
            />
            <datalist id={`${id}-depts`}>
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-job`}>Job</Label>
            <Input
              id={`${id}-job`}
              name="jobRef"
              value={jobRef}
              onChange={(e) => setJobRef(e.target.value)}
              placeholder="Nicobar"
            />
            <p className="text-muted-foreground text-xs">
              By name. Paper bought for this job is offered first.
            </p>
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
