import type { StageRow } from "./queries";
import type { StageRowInput } from "./validation";

export type StageChange = {
  id: string;
  name: string;
  values: Record<string, unknown>;
};

/**
 * Works out which stage rows actually changed.
 *
 * Extracted from the server action so it can be tested without an HTTP request
 * or a session. The comparison is fiddly in two ways that are invisible until
 * they bite:
 *
 *   - target_hours is numeric(6,2), so the database returns "4.00" while the
 *     form posts "4". Compared as strings, every stage looks changed on every
 *     save, and each one writes a meaningless audit row.
 *
 *   - blank and zero are different answers. Blank means no target at all;
 *     zero means the stage should be instantaneous. Collapsing one into the
 *     other silently changes what WIP ageing flags.
 */
export function computeStageChanges(
  current: StageRow[],
  submitted: Map<string, StageRowInput>,
): StageChange[] {
  const changes: StageChange[] = [];

  for (const row of current) {
    const next = submitted.get(row.id);
    if (!next) continue;

    const values: Record<string, unknown> = {};

    if (next.name !== row.name) values.name = next.name;
    if (next.sequence !== row.sequence) values.sequence = next.sequence;
    if (next.isOptional !== row.isOptional) values.isOptional = next.isOptional;
    if (next.appliesTo !== row.appliesTo) values.appliesTo = next.appliesTo;
    if (next.isActive !== row.isActive) values.isActive = next.isActive;

    // Hex is case-insensitive; #2563EB and #2563eb are the same colour.
    if (next.colour.toLowerCase() !== row.colour.toLowerCase()) {
      values.colour = next.colour.toLowerCase();
    }

    const nextTargetHours = next.targetHours === "" ? null : String(next.targetHours);
    const currentNumeric = row.targetHours === null ? null : Number(row.targetHours);
    const nextNumeric = nextTargetHours === null ? null : Number(nextTargetHours);
    if (currentNumeric !== nextNumeric) values.targetHours = nextTargetHours;

    if (next.targetHoursVerified !== row.targetHoursVerified) {
      values.targetHoursVerified = next.targetHoursVerified;
    }

    if (Object.keys(values).length > 0) {
      changes.push({ id: row.id, name: row.name, values });
    }
  }

  return changes;
}
