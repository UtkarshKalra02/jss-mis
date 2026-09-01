import { describe, expect, it } from "vitest";

import {
  planToolingMigration,
  renderPlan,
  UNKNOWN_LOCATION,
  type DesignSource,
} from "@/modules/tooling/migrate-from-design";

/**
 * The one-off move of design.die_id / plate_id into the tooling register.
 *
 * Tested as a pure function because it runs ONCE, against live data, and the
 * columns it reads are dropped immediately afterwards. There is one chance to
 * get it right and no way to re-read the source, so the plan is settled here
 * rather than discovered during the run.
 */

const d = (over: Partial<DesignSource> = {}): DesignSource => ({
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  designCode: "DSN-00001",
  clientId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
  jobName: "Fertilina Tab 60 carton",
  dieId: null,
  plateId: null,
  dieStatus: "NA",
  plateStatus: "NA",
  ...over,
});

describe("what gets migrated", () => {
  it("creates a DIE from die_id and a PLATE from plate_id", () => {
    const plan = planToolingMigration([d({ dieId: "OLD DIE (FERTILINA TAB 60)", plateId: "P-114" })]);

    expect(plan.tools).toHaveLength(2);
    expect(plan.tools.map((t) => t.toolType).sort()).toEqual(["DIE", "PLATE"]);
    expect(plan.designsAffected).toBe(1);
  });

  it("keeps the name exactly as it was typed", () => {
    // "OLD DIE (FERTILINA TAB 60)" is Punit's own words and is what he will
    // search for. Reformatting it would break the only continuity there is.
    const plan = planToolingMigration([d({ dieId: "OLD DIE (FERTILINA TAB 60)" })]);
    expect(plan.tools[0]!.name).toBe("OLD DIE (FERTILINA TAB 60)");
  });

  it("carries the design and its client onto the tool", () => {
    const plan = planToolingMigration([d({ dieId: "D-1" })]);
    expect(plan.tools[0]!.designId).toBe(d().id);
    expect(plan.tools[0]!.clientId).toBe(d().clientId);
  });

  it("skips a design that holds nothing", () => {
    const plan = planToolingMigration([d(), d({ id: "x", dieId: "   " })]);
    expect(plan.tools).toHaveLength(0);
    expect(plan.skipped).toBe(2);
  });

  it("treats the placeholders people type as empty", () => {
    // A die_id of "NA" is not a die. Migrating it would put junk in the
    // register on day one, which is how a new register stops being trusted.
    for (const filler of ["-", "--", "N/A", "na", "NIL", "none", "No", "x"]) {
      const plan = planToolingMigration([d({ dieId: filler })]);
      expect(plan.tools, filler).toHaveLength(0);
    }
  });
});

describe("the two mismatches, neither of them guessed", () => {
  it("marks every migrated row's location as not recorded", () => {
    // location is NOT NULL and the design record has none. A placeholder that
    // says so is honest; a blank is impossible and an invented rack is worse
    // than either.
    const plan = planToolingMigration([d({ dieId: "D-1" })]);
    expect(plan.tools[0]!.location).toBe(UNKNOWN_LOCATION);
    expect(plan.tools[0]!.location).toMatch(/please update/i);
  });

  it("preserves the old status verbatim instead of mapping it to an enum", () => {
    // Pending/Ordered/Received/Old/NA is a PROCUREMENT state. condition and
    // status describe the metal and where it is. Guessing a mapping would put
    // a value in an enum that then reads as a fact somebody established.
    const plan = planToolingMigration([d({ dieId: "D-1", dieStatus: "Ordered" })]);

    expect(plan.tools[0]!.remarks).toContain("Original die status: Ordered");
    expect(plan.tools[0]!.remarks).toContain("need checking");
  });

  it("does not record 'NA' as if it were a status somebody chose", () => {
    const plan = planToolingMigration([d({ dieId: "D-1", dieStatus: "NA" })]);
    expect(plan.tools[0]!.remarks).not.toContain("Original die status");
  });

  it("names the design the row came from, so the trail is followable", () => {
    const plan = planToolingMigration([d({ plateId: "P-1" })]);
    expect(plan.tools[0]!.remarks).toContain("DSN-00001");
    expect(plan.tools[0]!.remarks).toContain("Fertilina Tab 60 carton");
  });
});

describe("the dry-run report", () => {
  it("says what it would create, and says nothing is written", () => {
    const plan = planToolingMigration([
      d({ dieId: "D-1" }),
      d({ id: "b", designCode: "DSN-00002", plateId: "P-2" }),
    ]);

    const report = renderPlan(plan);
    expect(report).toContain("2 tooling rows would be created");
    expect(report).toContain("DSN-00001");
    expect(report).toContain("DSN-00002");
    // The two things a reader has to know before typing --apply.
    expect(report).toContain(UNKNOWN_LOCATION);
    expect(report).toContain("not guessed from the old status");
  });

  it("is explicit when there is nothing to do", () => {
    expect(renderPlan(planToolingMigration([d()]))).toContain("Nothing to migrate");
  });

  it("is deterministic — the report describes the write exactly", () => {
    // The dry run and the apply share this function, so a plan rendered twice
    // from the same input must be identical. If these ever diverge, the report
    // stops being a promise about what --apply will do.
    const designs = [d({ dieId: "D-1", plateId: "P-1" })];
    expect(renderPlan(planToolingMigration(designs))).toBe(
      renderPlan(planToolingMigration(designs)),
    );
  });
});
