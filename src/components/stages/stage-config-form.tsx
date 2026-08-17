"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { saveStagesAction, type FormState } from "@/modules/stages/actions";
import type { StageRow } from "@/modules/stages/queries";

const initialState: FormState = { ok: false, error: null };

function Submit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : `Save ${count} stages`}
    </Button>
  );
}

const inputClass =
  "border-input bg-background h-8 rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * One row of the stage table.
 *
 * Kept as its own component so the "measured" tick can track its own target
 * hours field: editing the number ticks the box automatically, because a value
 * a human just typed is by definition no longer the seeded placeholder. It can
 * still be unticked by hand — a better estimate is an estimate, and decision A2
 * exists so guesses never present themselves as measurements.
 */
function StageRowFields({ row }: { row: StageRow }) {
  const [hours, setHours] = useState(row.targetHours ?? "");
  const [verified, setVerified] = useState(row.targetHoursVerified);
  const [colour, setColour] = useState(row.colour);

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-2">
        {/* Immutable (C2). Shown so the row is identifiable, never editable. */}
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: `${colour}1f`, color: colour }}
          title="Stage codes cannot be changed — stage history references them"
        >
          {row.code}
        </span>
      </td>

      <td className="px-3 py-2">
        <input
          name={`name__${row.id}`}
          defaultValue={row.name}
          className={`${inputClass} w-full`}
          aria-label={`Name for ${row.code}`}
        />
      </td>

      <td className="px-3 py-2">
        <input
          name={`sequence__${row.id}`}
          defaultValue={row.sequence}
          type="number"
          min={0}
          max={9999}
          className={`${inputClass} w-16 text-right tabular-nums`}
          aria-label={`Sequence for ${row.code}`}
        />
      </td>

      <td className="px-3 py-2">
        <select
          name={`appliesTo__${row.id}`}
          defaultValue={row.appliesTo}
          className={`${inputClass} w-24`}
          aria-label={`Applies to, for ${row.code}`}
        >
          <option value="All">All</option>
          <option value="New">New</option>
          <option value="Repeat">Repeat</option>
        </select>
      </td>

      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          name={`isOptional__${row.id}`}
          defaultChecked={row.isOptional}
          className="size-4 align-middle"
          aria-label={`Optional stage, ${row.code}`}
        />
      </td>

      <td className="px-3 py-2">
        <input
          name={`targetHours__${row.id}`}
          value={hours}
          onChange={(e) => {
            setHours(e.target.value);
            if (e.target.value !== (row.targetHours ?? "")) setVerified(true);
          }}
          type="number"
          min={0}
          max={9999}
          step="0.25"
          placeholder="—"
          className={`${inputClass} w-20 text-right tabular-nums`}
          aria-label={`Target hours for ${row.code}`}
        />
      </td>

      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          name={`verified__${row.id}`}
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
          className="size-4 align-middle"
          aria-label={`Target hours measured, ${row.code}`}
        />
        {!verified ? (
          <span className="text-at-risk ml-2 align-middle text-[11px]">unverified</span>
        ) : null}
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            name={`colour__${row.id}`}
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            className="border-input size-7 cursor-pointer rounded border bg-transparent p-0.5"
            aria-label={`Colour for ${row.code}`}
          />
          <span className="text-muted-foreground text-[11px] tabular-nums">{colour}</span>
        </div>
      </td>

      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          name={`isActive__${row.id}`}
          defaultChecked={row.isActive}
          className="size-4 align-middle"
          aria-label={`Active, ${row.code}`}
        />
      </td>
    </tr>
  );
}

export function StageConfigForm({ stages }: { stages: StageRow[] }) {
  const [state, formAction] = useActionState(saveStagesAction, initialState);

  return (
    <form action={formAction}>
      <div className="overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="px-3 whitespace-nowrap">Code</th>
              <th className="px-3 whitespace-nowrap">Name</th>
              <th className="px-3 whitespace-nowrap">Seq</th>
              <th className="px-3 whitespace-nowrap">Applies to</th>
              <th className="px-3 whitespace-nowrap">Optional</th>
              <th className="px-3 whitespace-nowrap">Target hrs</th>
              <th className="px-3 whitespace-nowrap">Measured</th>
              <th className="px-3 whitespace-nowrap">Colour</th>
              <th className="px-3 whitespace-nowrap">Active</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((row) => (
              <StageRowFields key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <Submit count={stages.length} />
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
      </div>
    </form>
  );
}
