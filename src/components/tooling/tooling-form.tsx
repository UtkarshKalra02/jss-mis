"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  createToolingAction,
  updateToolingAction,
  type FormState,
} from "@/modules/tooling/actions";
import type { ToolingRow } from "@/modules/tooling/queries";
import {
  TOOL_TYPE_LABELS,
  toolConditions,
  toolStatuses,
  toolTypes,
} from "@/modules/tooling/validation";

const initialState: FormState = { ok: false, error: null };

type DesignOption = {
  id: string;
  designCode: string;
  jobName: string;
  clientName: string;
};

type ClientOption = { id: string; code: string; name: string };
type ToolOption = { id: string; toolNo: string; name: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Text({
  name,
  label,
  hint,
  defaultValue,
  required,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
      />
      {hint ? <span className="text-muted-foreground mt-1 block text-[12px]">{hint}</span> : null}
    </label>
  );
}

/**
 * Add and edit tooling.
 *
 * TWO THINGS ABOUT THIS FORM ARE DELIBERATE.
 *
 * `location` is required and sits at the top, above everything except what the
 * tool is. It is the field the register exists to answer, and burying it under
 * cost and vendor would make it the field people skip.
 *
 * The COLOUR field appears only for plates. There is no database constraint
 * enforcing that (I6) — foil blocks genuinely have a foil colour, and a rule
 * that is wrong on the floor gets worked around — so this is presentation, not
 * validation: the field is hidden where it usually means nothing, and any value
 * already recorded is preserved rather than cleared.
 */
export function ToolingForm({
  mode,
  tool,
  designs,
  clients,
  replaceable,
}: {
  mode: "create" | "edit";
  tool?: ToolingRow & { madeDate?: string | null; vendor?: string | null; cost?: string | null; impressionsUsed?: number | null; lastUsedDate?: string | null; replacesToolId?: string | null; remarks?: string | null };
  designs: DesignOption[];
  clients: ClientOption[];
  replaceable: ToolOption[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    mode === "create" ? createToolingAction : updateToolingAction,
    initialState,
  );

  const [toolType, setToolType] = useState(tool?.toolType ?? "DIE");
  const [designId, setDesignId] = useState(tool?.designId ?? "");

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state.ok, state.redirectTo, router]);

  return (
    <form action={formAction} className="space-y-6">
      {mode === "edit" ? <input type="hidden" name="id" value={tool!.id} /> : null}

      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[13px] font-medium">Type</span>
            <select
              name="toolType"
              value={toolType}
              onChange={(e) => setToolType(e.target.value)}
              className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
            >
              {toolTypes.map((t) => (
                <option key={t} value={t}>
                  {TOOL_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {mode === "edit" ? (
              <span className="text-muted-foreground mt-1 block text-[12px]">
                The tool number keeps its original prefix. It is written on the metal, and
                renumbering after the fact is how the shelf and the screen stop agreeing.
              </span>
            ) : null}
          </label>

          <Text
            name="name"
            label="Name"
            required
            defaultValue={tool?.name}
            placeholder="OLD DIE (FERTILINA TAB 60)"
            hint="What it is, in your words. This is what people search for."
          />
        </div>

        {/* The field the register exists for. */}
        <Text
          name="location"
          label="Location"
          required
          defaultValue={tool?.location}
          placeholder="Rack 3, almirah 2, top shelf"
          hint="Rack, almirah or shelf. The most-read field in the register — be specific enough that somebody else can find it."
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Condition and whereabouts</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[13px] font-medium">Condition</span>
            <select
              name="condition"
              defaultValue={tool?.condition ?? "Good"}
              className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
            >
              {toolConditions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[13px] font-medium">Status</span>
            <select
              name="status"
              defaultValue={tool?.status ?? "In House"}
              className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
            >
              {toolStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground mt-1 block text-[12px]">
              Set by hand. There is no issue/return workflow — if it goes to a vendor, change
              this.
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">What it is for</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[13px] font-medium">Design</span>
            <select
              name="designId"
              value={designId}
              onChange={(e) => setDesignId(e.target.value)}
              className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
            >
              <option value="">None — generic tooling</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.designCode} · {d.jobName} · {d.clientName}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[13px] font-medium">Client</span>
            <select
              name="clientId"
              defaultValue={tool?.clientId ?? ""}
              disabled={designId !== ""}
              className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px] disabled:opacity-60"
            >
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground mt-1 block text-[12px]">
              {designId
                ? "Taken from the design. The database sets it, so the two cannot disagree."
                : "Only for tooling with no design against it."}
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">The tool itself</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Text name="size" label="Size" defaultValue={tool?.size} />

          {/* Plates only, by presentation. The column is not constrained (I6). */}
          {toolType === "PLATE" ? (
            <Text
              name="colour"
              label="Colour"
              defaultValue={tool?.colour}
              hint="Which colour of the set this plate carries."
            />
          ) : null}

          <Text name="madeDate" label="Made on" type="date" defaultValue={tool?.madeDate} />
          <Text name="vendor" label="Made by" defaultValue={tool?.vendor} placeholder="Vendor" />
          <Text name="cost" label="Cost" type="number" defaultValue={tool?.cost} />
          <Text
            name="impressionsUsed"
            label="Impressions used"
            type="number"
            defaultValue={tool?.impressionsUsed}
            hint="Typed by hand. Nothing counts these automatically."
          />
          <Text
            name="lastUsedDate"
            label="Last used"
            type="date"
            defaultValue={tool?.lastUsedDate}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Replacement</h2>
        <label className="block">
          <span className="text-[13px] font-medium">This replaces</span>
          <select
            name="replacesToolId"
            defaultValue={tool?.replacesToolId ?? ""}
            className="border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]"
          >
            <option value="">Nothing — this is the original</option>
            {replaceable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.toolNo} · {t.name}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground mt-1 block text-[12px]">
            For a new die cut to replace a worn one. The old record stays exactly as it is —
            this points back at it, so the history reads newest first.
          </span>
        </label>

        <label className="block">
          <span className="text-[13px] font-medium">Remarks</span>
          <textarea
            name="remarks"
            rows={3}
            maxLength={1000}
            defaultValue={tool?.remarks ?? ""}
            className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
          />
        </label>
      </section>

      <div className="flex items-center gap-3">
        <Submit label={mode === "create" ? "Add to register" : "Save"} />
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
    </form>
  );
}
