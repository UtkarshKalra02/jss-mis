"use client";

import { useActionState, useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { materialUnitEnum } from "@/db/schema/enums";
import {
  createMaterialAction,
  updateMaterialAction,
  type FormState,
} from "@/modules/materials/actions";
import type { CategoryOption, TypeOption } from "@/modules/materials/queries";
import type { Material } from "@/db/schema";

import { Feedback, Submit, inputClass, useRedirectOnSuccess } from "./form-bits";

const initialState: FormState = { ok: false, error: null };

/**
 * One material, added or edited (section O).
 *
 * Category and type are chosen ONCE, on creation, because they are the SKU
 * (O1): P-SBS-001 is a category, a type and a number, and a code that changes
 * under a printed label is a code nobody can trust. The edit form shows both
 * and lets neither change; a wrong one is fixed by retiring the item.
 *
 * GSM is a whole number. The sheet had "330Gsm" as text; the job card's
 * picker needs to subtract it from something (O2).
 */
export function MaterialForm({
  material,
  categories,
  types,
}: {
  material?: Material;
  categories: CategoryOption[];
  types: TypeOption[];
}) {
  const editing = Boolean(material);
  const [state, formAction] = useActionState(
    editing ? updateMaterialAction : createMaterialAction,
    initialState,
  );
  useRedirectOnSuccess(state);
  const id = useId();

  const cat = categories.find((c) => c.id === material?.categoryId);
  const typ = types.find((t) => t.id === material?.typeId);

  return (
    <form action={formAction} className="space-y-6">
      {material ? <input type="hidden" name="id" value={material.id} /> : null}

      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">What it is</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              name="name"
              required
              defaultValue={material?.name ?? ""}
              placeholder="Sbs Paper 23X36 300Gsm White"
            />
          </div>

          {editing ? (
            <>
              <div className="space-y-2">
                <Label>Category</Label>
                <p className="text-[13px]">{cat?.name ?? "—"}</p>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <p className="text-[13px]">
                  {typ?.name ?? "—"}
                  <span className="text-muted-foreground ml-2 text-xs">
                    Fixed — they are part of the SKU.
                  </span>
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor={`${id}-cat`}>Category</Label>
                <select id={`${id}-cat`} name="categoryId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {categories
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-type`}>Type</Label>
                <select id={`${id}-type`} name="typeId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {types
                    .filter((t) => t.isActive)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                </select>
                <p className="text-muted-foreground text-xs">
                  The SKU is built from these two and allocated on save.
                </p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor={`${id}-size`}>Size</Label>
            <Input id={`${id}-size`} name="size" defaultValue={material?.size ?? ""} placeholder="23X36" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-gsm`}>GSM / micron</Label>
            <Input
              id={`${id}-gsm`}
              name="gsm"
              type="number"
              min={1}
              step={1}
              defaultValue={material?.gsm ?? ""}
              className="text-right tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-colour`}>Colour</Label>
            <Input id={`${id}-colour`} name="colour" defaultValue={material?.colour ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-finish`}>Finish / extra</Label>
            <Input id={`${id}-finish`} name="finish" defaultValue={material?.finish ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-unit`}>Counted in</Label>
            <select
              id={`${id}-unit`}
              name="unit"
              required
              defaultValue={material?.unit ?? "Sheet"}
              className={inputClass}
            >
              {materialUnitEnum.enumValues.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-active`}>Status</Label>
            <select
              id={`${id}-active`}
              name="isActive"
              defaultValue={material?.isActive === false ? "false" : "true"}
              className={inputClass}
            >
              <option value="true">Active</option>
              <option value="false">Retired — not offered on new receipts or cards</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Reorder figures</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          All optional. Days remaining and the reorder flag on the stock list are computed from
          these; leave one blank and that part of the answer is left blank too.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor={`${id}-adc`}>Average daily consumption</Label>
            <Input
              id={`${id}-adc`}
              name="averageDailyConsumption"
              type="number"
              min={0}
              step="0.01"
              defaultValue={material?.averageDailyConsumption ?? ""}
              className="text-right tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-lead`}>Lead time (days)</Label>
            <Input
              id={`${id}-lead`}
              name="leadTimeDays"
              type="number"
              min={0}
              step={1}
              defaultValue={material?.leadTimeDays ?? ""}
              className="text-right tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-moq`}>Minimum order qty</Label>
            <Input
              id={`${id}-moq`}
              name="minOrderQty"
              type="number"
              min={0}
              step="0.01"
              defaultValue={material?.minOrderQty ?? ""}
              className="text-right tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-max`}>Max level</Label>
            <Input
              id={`${id}-max`}
              name="maxLevel"
              type="number"
              min={0}
              step="0.01"
              defaultValue={material?.maxLevel ?? ""}
              className="text-right tabular-nums"
            />
            <p className="text-muted-foreground text-xs">Reorder level is 80% of this.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-transit`}>In transit</Label>
            <Input
              id={`${id}-transit`}
              name="inTransitQty"
              type="number"
              min={0}
              step="0.01"
              defaultValue={material?.inTransitQty ?? ""}
              className="text-right tabular-nums"
            />
            <p className="text-muted-foreground text-xs">
              Ordered, not arrived. Typed by hand; clear it when the GRN is entered.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label htmlFor={`${id}-remarks`}>Remarks</Label>
            <Input id={`${id}-remarks`} name="remarks" defaultValue={material?.remarks ?? ""} />
          </div>
        </div>
      </section>

      <Feedback state={state} />
      <Submit label={editing ? "Save material" : "Add material"} />
    </form>
  );
}
