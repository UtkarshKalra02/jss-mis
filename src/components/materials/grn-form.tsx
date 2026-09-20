"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayIST } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { createGrnAction, type FormState } from "@/modules/materials/actions";
import type { MaterialOption } from "@/modules/materials/queries";

import { Feedback, Submit, inputClass, useRedirectOnSuccess } from "./form-bits";

const initialState: FormState = { ok: false, error: null };

type Line = { key: string; materialId: string; qty: string; jobRef: string; remarks: string };
let seq = 0;
const blank = (materialId = ""): Line => ({ key: `l${(seq += 1)}`, materialId, qty: "", jobRef: "", remarks: "" });

/**
 * A goods receipt: one vendor document, one or more lines, each becoming a
 * batch (section O). Lines post as parallel arrays like the PO form's items,
 * and for the same reason every row renders every field.
 */
export function GrnForm({
  materials,
  presetMaterialId,
}: {
  materials: MaterialOption[];
  /** From ?material=…, so "Receive more" on a material's page starts filled. */
  presetMaterialId?: string;
}) {
  const [state, formAction] = useActionState(createGrnAction, initialState);
  useRedirectOnSuccess(state);
  const id = useId();
  const [lines, setLines] = useState<Line[]>([blank(presetMaterialId)]);

  const patch = (key: string, field: keyof Line, value: string) =>
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  return (
    <form action={formAction} className="space-y-6">
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Receipt</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-date`}>Received on</Label>
            <Input id={`${id}-date`} name="receivedDate" type="date" required defaultValue={todayIST()} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-vendor`}>Vendor</Label>
            <Input id={`${id}-vendor`} name="vendor" required placeholder="M/s Sugandh Enterprises" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-inv`}>Invoice / challan no.</Label>
            <Input id={`${id}-inv`} name="invoiceNo" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-url`}>Invoice scan</Label>
            <Input id={`${id}-url`} name="invoiceUrl" type="url" placeholder="https://drive.google.com/…" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-remarks`}>Remarks</Label>
            <Input id={`${id}-remarks`} name="remarks" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Lines</h2>
          <span className="text-muted-foreground text-xs">
            Each line becomes a batch. If the material was marked in transit, clear that on its
            page.
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="data-grid w-full">
            <thead>
              <tr>
                <th className="w-8 px-2"></th>
                <th className="min-w-72 px-2">Material</th>
                <th className="w-32 px-2 text-right">Qty</th>
                <th className="min-w-40 px-2">For job</th>
                <th className="min-w-40 px-2">Remarks</th>
                <th className="w-10 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const chosen = materials.find((m) => m.id === line.materialId);
                return (
                  <tr key={line.key}>
                    <td className="text-muted-foreground px-2 text-center tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1">
                      <select
                        name="materialId"
                        required
                        value={line.materialId}
                        onChange={(e) => patch(line.key, "materialId", e.target.value)}
                        className={inputClass}
                        aria-label={`Material, line ${i + 1}`}
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
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          name="qty"
                          type="number"
                          min={0.01}
                          step="0.01"
                          required
                          value={line.qty}
                          onChange={(e) => patch(line.key, "qty", e.target.value)}
                          className={`${inputClass} text-right tabular-nums`}
                          aria-label={`Quantity, line ${i + 1}`}
                        />
                        <span className="text-muted-foreground w-10 text-[11px]">{chosen?.unit ?? ""}</span>
                      </div>
                    </td>
                    {/* Paper bought for a particular job (P3). Issues for
                        that job are offered this batch first. */}
                    <td className="px-2 py-1">
                      <input
                        name="lineJobRef"
                        value={line.jobRef}
                        onChange={(e) => patch(line.key, "jobRef", e.target.value)}
                        className={inputClass}
                        placeholder="Nicobar"
                        aria-label={`Job, line ${i + 1}`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        name="lineRemarks"
                        value={line.remarks}
                        onChange={(e) => patch(line.key, "remarks", e.target.value)}
                        className={inputClass}
                        aria-label={`Remarks, line ${i + 1}`}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
                        disabled={lines.length === 1}
                        className="text-muted-foreground hover:text-overdue disabled:opacity-30"
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <X className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((r) => [...r, blank()])}>
          <Plus className="size-4" /> Add line
        </Button>
      </section>

      <Feedback state={state} />
      <Submit label="Record receipt" />
    </form>
  );
}
