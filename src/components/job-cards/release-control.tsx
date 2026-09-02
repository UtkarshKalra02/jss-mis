"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { releaseJobCardAction, type FormState } from "@/modules/job-cards/actions";
import { supplyByValues } from "@/modules/job-cards/validation";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px]";

function Submit({ label, name, value }: { label: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} disabled={pending} size="sm">
      {pending ? "Releasing…" : label}
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

function SupplySelect({ name, label }: { name: string; label: string }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <select name={name} defaultValue="" className={inputClass}>
        {/* Blank is the honest default. Neither 'Press' nor 'Party' is a safe
            guess, and whichever is picked gets PRINTED on the sheet the floor
            works from as though somebody had decided it. */}
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
 * Releases an item to production — the only thing in the system that creates a
 * job card (J1).
 *
 * It is a form rather than a single button because a job card that is worth
 * printing needs the paper, plate and machine details on it, and the moment
 * somebody is releasing the job is the moment they know them. A one-click
 * release would produce a numbered document with five blank lines on it, which
 * is the outcome the automatic-trigger design was rejected for.
 *
 * Everything here is optional except the item itself. A card released before
 * the machine is decided is still a useful card — it prints with a blank line
 * for hand entry (J5), which is exactly what the paper form it replaces does.
 */
export function ReleaseJobCardControl({
  poItemId,
  itemCode,
  pendingQty,
  hasExistingCard,
}: {
  poItemId: string;
  itemCode: string;
  pendingQty: number;
  hasExistingCard: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(releaseJobCardAction, initialState);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state.ok, state.redirectTo, router]);

  if (!open) {
    return (
      <div className="mt-4">
        <Button size="sm" variant={hasExistingCard ? "outline" : "default"} onClick={() => setOpen(true)}>
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
    <form action={formAction} className="bg-muted/30 mt-4 rounded-lg border p-4">
      <input type="hidden" name="poItemId" value={poItemId} />

      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Release {itemCode} to production</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground text-[12px] hover:underline"
        >
          Cancel
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          name="plannedQty"
          label="Quantity to run"
          type="number"
          defaultValue={pendingQty}
          hint="Defaults to what is still owed. Lower it for a split run."
        />
        <Field
          name="plannedDate"
          label="Planned date"
          type="date"
          hint="Optional. The planning board sets this in Phase 4."
        />

        <SupplySelect name="paperSupplyBy" label="Paper supplied by" />
        <SupplySelect name="plateSupplyBy" label="Plate supplied by" />

        <Field name="plateJobId" label="Plate / Job ID" placeholder="As the platemaker gave it" />
        <Field
          name="machineDetail"
          label="Machine"
          placeholder="e.g. Heidelberg SM 74"
          hint="Free text — there is no machine list in this system."
        />
      </div>

      <label className="mt-4 block">
        <span className="text-[13px] font-medium">Notes for the floor</span>
        <textarea
          name="notes"
          rows={2}
          maxLength={1000}
          className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
        />
      </label>

      {/* The second-card question (J3). The acknowledgement rides on the
          BUTTON's own name/value, not a hidden input driven by state: a click
          submits before React re-renders, so a state-driven flag would arrive
          one submit late and the form would ask twice (F20). */}
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
          <Submit label="Release" />
          {state.error ? (
            <p role="alert" className="text-overdue text-[13px]">
              {state.error}
            </p>
          ) : null}
        </div>
      )}
    </form>
  );
}
