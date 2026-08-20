"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { StagePill } from "@/components/stages/stage-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dieplateStatusEnum } from "@/db/schema/enums";
import type { ClientOption, RouteStage } from "@/modules/designs/queries";
import {
  createDesignAction,
  updateDesignAction,
  type FormState,
} from "@/modules/designs/actions";

const initialState: FormState = { ok: false, error: null };

type DesignValues = {
  id?: string;
  designCode?: string;
  clientId?: string;
  jobName?: string;
  jobSize?: string | null;
  gsm?: string | null;
  paperType?: string | null;
  printType?: string | null;
  noOfColours?: string | null;
  dieId?: string | null;
  plateId?: string | null;
  dieStatus?: string;
  plateStatus?: string;
  artworkUrl?: string | null;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Field({
  name,
  label,
  hint,
  ...props
}: { name: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

const selectClass =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * Die and plate status options come from the Postgres enum, not from a list
 * typed here — non-negotiable 5. Adding a value to the enum makes it appear in
 * both dropdowns with no edit to this file.
 */
function DiePlateStatus({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <select id={name} name={name} defaultValue={defaultValue ?? "NA"} className={selectClass}>
        {dieplateStatusEnum.enumValues.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DesignForm({
  mode,
  design,
  clients,
  stages,
  selectedProcesses,
}: {
  mode: "create" | "edit";
  design?: DesignValues;
  clients: ClientOption[];
  stages: RouteStage[];
  selectedProcesses: string[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    mode === "create" ? createDesignAction : updateDesignAction,
    initialState,
  );

  // A created design opens on its own page, where die, plate, route and
  // approval are waiting to be filled in.
  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  const selected = new Set(selectedProcesses);

  return (
    <form action={formAction} className="space-y-8">
      {mode === "edit" ? <input type="hidden" name="id" value={design!.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Job</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="clientId">Client</Label>
            <select
              id="clientId"
              name="clientId"
              required
              defaultValue={design?.clientId ?? ""}
              className={selectClass}
            >
              <option value="" disabled>
                Choose a client…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                  {c.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              A design belongs to one client. Nothing is ganged across clients in v1.
            </p>
          </div>

          <Field
            name="jobName"
            label="Job name"
            required
            defaultValue={design?.jobName ?? ""}
            placeholder="250ml carton — outer"
          />
          <Field
            name="jobSize"
            label="Size"
            defaultValue={design?.jobSize ?? ""}
            placeholder="12 × 8 × 4 cm"
          />
          <Field
            name="paperType"
            label="Paper"
            defaultValue={design?.paperType ?? ""}
            placeholder="SBS board"
          />
          <Field
            name="gsm"
            label="GSM"
            defaultValue={design?.gsm ?? ""}
            placeholder="300"
            inputMode="numeric"
          />
          <Field
            name="printType"
            label="Print type"
            defaultValue={design?.printType ?? ""}
            placeholder="Offset"
          />
          <Field
            name="noOfColours"
            label="Colours"
            defaultValue={design?.noOfColours ?? ""}
            placeholder="4 + 1"
            hint="Free text — 4+1, CMYK + Pantone, and so on."
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Die and plate</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="dieId"
            label="Die ID"
            defaultValue={design?.dieId ?? ""}
            hint="The physical die's reference, as marked on it."
          />
          <DiePlateStatus name="dieStatus" label="Die status" defaultValue={design?.dieStatus} />
          <Field name="plateId" label="Plate ID" defaultValue={design?.plateId ?? ""} />
          <DiePlateStatus
            name="plateStatus"
            label="Plate status"
            defaultValue={design?.plateStatus}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Route</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Which stages this design actually passes through. Leave every box clear and the
            job follows the default route for its type instead — a route here overrides
            that, so only set one when this design genuinely differs.
          </p>
        </div>

        {/* Read from the stage table in sequence order (non-negotiable 5).
            A stage ADMIN adds appears here with no change to this file. */}
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {stages.map((s) => (
            <label
              key={s.code}
              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2"
            >
              <input
                type="checkbox"
                name="processes"
                value={s.code}
                defaultChecked={selected.has(s.code)}
                className="accent-primary size-4"
              />
              <StagePill name={s.name} colour={s.colour} />
              {s.isOptional ? (
                <span className="text-muted-foreground ml-auto text-[11px]">optional</span>
              ) : null}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Artwork</h2>
        <Field
          name="artworkUrl"
          label="Artwork link"
          type="url"
          defaultValue={design?.artworkUrl ?? ""}
          placeholder="https://drive.google.com/…"
          hint="Paste a Drive link. File upload arrives later; a link somebody else can open is the point."
        />
      </section>

      {/* Section 7: inline validation, never a modal for errors. */}
      {state.error ? (
        <p role="alert" className="text-overdue text-sm">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time text-sm">
          {state.message}
        </p>
      ) : null}

      <Submit label={mode === "create" ? "Add design" : "Save changes"} />
    </form>
  );
}
