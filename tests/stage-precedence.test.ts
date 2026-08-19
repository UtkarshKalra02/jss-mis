import { describe, expect, it } from "vitest";

import {
  isBackwardMove,
  stageChoicesFor,
  type StageOption,
} from "@/modules/stage-update/precedence";

/**
 * Decision F4's precedence, tested as a pure function.
 *
 * No database, no session, no browser — which is the point of extracting it.
 * This is the rule most likely to be argued about a year from now, and an
 * argument is far easier to settle against a test than against a component.
 */

const stage = (over: Partial<StageOption> & { code: string; sequence: number }): StageOption => ({
  name: over.code,
  colour: "#000000",
  isOptional: false,
  appliesTo: "All",
  ...over,
});

/** A trimmed version of the seeded table, enough to exercise every branch. */
const STAGES: StageOption[] = [
  stage({ code: "ENQUIRY", sequence: 10, appliesTo: "New" }),
  stage({ code: "COSTING", sequence: 20, appliesTo: "New" }),
  stage({ code: "PO_RECEIVED", sequence: 30 }),
  stage({ code: "DESIGN", sequence: 40 }),
  stage({ code: "PRINTING", sequence: 70 }),
  stage({ code: "LAMINATION", sequence: 80, isOptional: true }),
  stage({ code: "DIE_CUT", sequence: 110 }),
  stage({ code: "READY", sequence: 130 }),
  stage({ code: "DISPATCHED", sequence: 140 }),
];

const codes = (list: StageOption[]) => list.map((s) => s.code);

describe("stageChoicesFor", () => {
  it("uses the design's route when it has one, whatever the job type says", () => {
    const choices = stageChoicesFor(
      { jobType: "New", routeCodes: ["PRINTING", "LAMINATION", "DIE_CUT"] },
      STAGES,
    );

    expect(choices.basis).toBe("design");
    expect(codes(choices.route)).toEqual(["PRINTING", "LAMINATION", "DIE_CUT"]);
    // ENQUIRY and COSTING apply to New jobs, but this design's route wins.
    expect(codes(choices.other)).toContain("ENQUIRY");
  });

  it("falls back to applies_to filtered by the JOB's type", () => {
    const repeat = stageChoicesFor({ jobType: "Repeat", routeCodes: [] }, STAGES);

    expect(repeat.basis).toBe("jobType");
    // A repeat run skips enquiry and costing.
    expect(codes(repeat.route)).not.toContain("ENQUIRY");
    expect(codes(repeat.route)).not.toContain("COSTING");
    expect(codes(repeat.other)).toEqual(["ENQUIRY", "COSTING"]);
  });

  it("keeps enquiry and costing for a genuinely new job (B4)", () => {
    // The whole reason job_type exists rather than reusing client_type: a
    // long-standing repeat client still places new jobs.
    const fresh = stageChoicesFor({ jobType: "New", routeCodes: [] }, STAGES);

    expect(codes(fresh.route)).toContain("ENQUIRY");
    expect(codes(fresh.route)).toContain("COSTING");
    expect(fresh.other).toEqual([]);
  });

  it("never drops a stage — route and other together are everything (F18)", () => {
    for (const args of [
      { jobType: "New" as const, routeCodes: ["PRINTING"] },
      { jobType: "Repeat" as const, routeCodes: [] },
      { jobType: "New" as const, routeCodes: [] },
    ]) {
      const choices = stageChoicesFor(args, STAGES);
      const all = [...codes(choices.route), ...codes(choices.other)].sort();

      // Preeti has to be able to reach READY and DISPATCHED regardless, and a
      // dropdown that hides a stage somebody needs at 6pm gets worked around.
      expect(all).toEqual(codes(STAGES).sort());
    }
  });

  it("returns both lists in sequence order, not table order", () => {
    const shuffled = [...STAGES].reverse();
    const choices = stageChoicesFor({ jobType: "New", routeCodes: [] }, shuffled);

    const sequences = choices.route.map((s) => s.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it("carries is_optional through rather than filtering on it", () => {
    // Optional is guidance — "not every job needs this" — not a restriction.
    const choices = stageChoicesFor(
      { jobType: "New", routeCodes: ["PRINTING", "LAMINATION"] },
      STAGES,
    );

    expect(choices.route.find((s) => s.code === "LAMINATION")?.isOptional).toBe(true);
  });

  it("treats a design route naming an unknown stage as simply not matching", () => {
    // The FK on design_process makes this impossible in practice; the function
    // should degrade rather than throw if it ever happens.
    const choices = stageChoicesFor(
      { jobType: "New", routeCodes: ["PRINTING", "NOT_A_STAGE"] },
      STAGES,
    );

    expect(codes(choices.route)).toEqual(["PRINTING"]);
  });
});

describe("isBackwardMove", () => {
  it("flags a move to an earlier stage", () => {
    expect(isBackwardMove(110, 70)).toBe(true);
  });

  it("does not flag a forward move or a repeat of the same stage", () => {
    expect(isBackwardMove(70, 110)).toBe(false);
    expect(isBackwardMove(70, 70)).toBe(false);
  });

  it("does not flag anything when there is no current stage", () => {
    // No sequence to compare against. Inventing a confirmation for a
    // comparison that was not made trains people to click through them.
    expect(isBackwardMove(null, 70)).toBe(false);
    expect(isBackwardMove(undefined, 70)).toBe(false);
  });
});
