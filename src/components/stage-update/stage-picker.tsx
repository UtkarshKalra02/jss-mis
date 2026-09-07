"use client";

import { stageChoicesFor, type StageOption } from "@/modules/stage-update/precedence";

/**
 * The stage dropdown, grouped by decision F4.
 *
 * The stages for this job's type come first, and everything else follows under
 * "Other stages" — because nothing is ever removed from this list (F18): a
 * dropdown that hides the stage somebody needs at 6pm gets worked around, and
 * the workaround is worse than the wrong order.
 */
export function StagePicker({
  stages,
  jobType,
  value,
  onChange,
  className,
  id,
  name,
  ariaLabel,
  required,
}: {
  stages: StageOption[];
  jobType: "New" | "Repeat";
  value: string;
  onChange: (code: string) => void;
  className?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  required?: boolean;
}) {
  const choices = stageChoicesFor({ jobType }, stages);

  return (
    <select
      id={id}
      name={name}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      aria-label={ariaLabel}
    >
      <option value="">Move to…</option>

      <optgroup label={`Stages for a ${jobType.toLowerCase()} job`}>
        {choices.forJobType.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
            {s.isOptional ? " (optional)" : ""}
          </option>
        ))}
      </optgroup>

      {choices.other.length > 0 ? (
        <optgroup label="Other stages">
          {choices.other.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
              {s.isOptional ? " (optional)" : ""}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}
