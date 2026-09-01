/**
 * Planning the one-off move of design.die_id / plate_id into the tooling
 * register (decision I7).
 *
 * The PLAN is a pure function, deliberately. This migration runs once, against
 * live data, and then the columns it reads are dropped — so there is exactly
 * one chance to get it right and no way to re-read the source afterwards. A
 * pure planner means the dry run and the apply compute the SAME plan from the
 * same input, rather than the dry run being a separate description of what the
 * writer is believed to do.
 *
 * TWO MISMATCHES BETWEEN THE OLD SHAPE AND THE NEW ONE, and neither is guessed:
 *
 *   - `location` is NOT NULL and the design record has none. Migrated rows get
 *     a visible placeholder rather than a blank or an invention.
 *   - the old die/plate status vocabulary (Pending, Ordered, Received, Old, NA)
 *     is a PROCUREMENT state and does not map onto `condition` or `status`,
 *     which describe the metal and where it is. Guessing a mapping would put a
 *     value in an enum that reads as fact. The original is preserved verbatim
 *     in `remarks` instead, for Punit to resolve from the shelf.
 */

export const UNKNOWN_LOCATION = "Not recorded — please update";

export type DesignSource = {
  id: string;
  designCode: string;
  clientId: string;
  jobName: string;
  dieId: string | null;
  plateId: string | null;
  dieStatus: string;
  plateStatus: string;
};

export type PlannedTool = {
  designId: string;
  designCode: string;
  clientId: string;
  toolType: "DIE" | "PLATE";
  /** Punit's own words, taken from the free-text column as written. */
  name: string;
  location: string;
  remarks: string;
  /** Which column it came from, for the dry-run report. */
  source: "die_id" | "plate_id";
};

export type MigrationPlan = {
  tools: PlannedTool[];
  /** Designs holding nothing worth migrating, counted rather than listed. */
  skipped: number;
  /** Designs contributing at least one tool. */
  designsAffected: number;
};

/** Blank, whitespace, and the placeholders people type instead of leaving it empty. */
const NOTHING = new Set(["", "-", "--", "n/a", "na", "nil", "none", "no", "x"]);

function meaningful(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (NOTHING.has(text.toLowerCase())) return null;
  return text;
}

/**
 * Preserves the old status without pretending it is the new one.
 *
 * 'NA' is dropped rather than recorded: it is the column's default and means
 * "nobody said", which is not a fact worth carrying into a remark.
 */
function statusNote(label: string, status: string): string {
  return status && status !== "NA" ? ` Original ${label} status: ${status}.` : "";
}

/**
 * Works out what the register would gain from the design table.
 *
 * Deterministic and side-effect free: same designs in, same plan out, so the
 * dry run's report is literally what the apply will write.
 */
export function planToolingMigration(designs: readonly DesignSource[]): MigrationPlan {
  const tools: PlannedTool[] = [];
  const affected = new Set<string>();

  for (const d of designs) {
    const die = meaningful(d.dieId);
    const plate = meaningful(d.plateId);

    if (die) {
      tools.push({
        designId: d.id,
        designCode: d.designCode,
        clientId: d.clientId,
        toolType: "DIE",
        name: die,
        location: UNKNOWN_LOCATION,
        remarks:
          `Migrated from the design record (${d.designCode} — ${d.jobName}).` +
          statusNote("die", d.dieStatus) +
          " Location and condition were not recorded on the design and need checking.",
        source: "die_id",
      });
      affected.add(d.id);
    }

    if (plate) {
      tools.push({
        designId: d.id,
        designCode: d.designCode,
        clientId: d.clientId,
        toolType: "PLATE",
        name: plate,
        location: UNKNOWN_LOCATION,
        remarks:
          `Migrated from the design record (${d.designCode} — ${d.jobName}).` +
          statusNote("plate", d.plateStatus) +
          " Location and condition were not recorded on the design and need checking.",
        source: "plate_id",
      });
      affected.add(d.id);
    }
  }

  return {
    tools,
    designsAffected: affected.size,
    skipped: designs.length - affected.size,
  };
}

/** The dry-run report, as text, so the script and a test render the same thing. */
export function renderPlan(plan: MigrationPlan): string {
  if (plan.tools.length === 0) {
    return "Nothing to migrate. No design holds a die or plate value worth moving.";
  }

  const lines = [
    `${plan.tools.length} tooling row${plan.tools.length === 1 ? "" : "s"} would be created,`,
    `from ${plan.designsAffected} design${plan.designsAffected === 1 ? "" : "s"}.`,
    `${plan.skipped} design${plan.skipped === 1 ? "" : "s"} hold nothing worth migrating.`,
    "",
    "Every row is created with:",
    `  location = "${UNKNOWN_LOCATION}"   (the design record has no location)`,
    "  condition = Good, status = In House  (not guessed from the old status —",
    "                                        that is kept verbatim in remarks)",
    "",
  ];

  for (const t of plan.tools) {
    lines.push(`  ${t.toolType.padEnd(5)} ${t.designCode}  ${t.source.padEnd(8)}  ${t.name}`);
  }

  return lines.join("\n");
}
