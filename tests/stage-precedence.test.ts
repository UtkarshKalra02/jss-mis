import { describe, expect, it } from "vitest";

import {
  isBackwardMove,
  stageChoicesFor,
  type StageOption,
} from "@/modules/stage-update/precedence";

/**
 * Decision F4, tested as a pure function.
 *
 * No database, no session, no browser — which is the point of extracting it.
 * This is the rule most likely to be argued about a year from now, and an
 * argument is far easier to settle against a test than against a component.
 *
 * The per-design route that used to sit above `applies_to` was removed in J22,
 * so what is left is one source: the JOB's type.
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
  it("offers a new job's stages, in sequence order", () => {
    const choices = stageChoicesFor({ jobType: "New" }, STAGES);

    expect(codes(choices.forJobType)).toEqual([
      "ENQUIRY",
      "COSTING",
      "PO_RECEIVED",
      "DESIGN",
      "PRINTING",
      "LAMINATION",
      "DIE_CUT",
      "READY",
      "DISPATCHED",
    ]);
    expect(choices.other).toEqual([]);
  });

  it("drops ENQUIRY and COSTING for a repeat run", () => {
    // B4: the JOB's type, not the client's. A repeat run from a new client
    // skips them; a genuinely new job from a long-standing client does not.
    const choices = stageChoicesFor({ jobType: "Repeat" }, STAGES);

    expect(codes(choices.forJobType)).not.toContain("ENQUIRY");
    expect(codes(choices.forJobType)).not.toContain("COSTING");
    expect(codes(choices.other)).toEqual(["ENQUIRY", "COSTING"]);
  });

  it("NEVER removes a stage from the dropdown, whatever the job type", () => {
    // F18. A rule that hides the stage somebody needs at 6pm gets worked
    // around, and the workaround is worse than the wrong order. The two lists
    // together are always exactly the whole table.
    for (const jobType of ["New", "Repeat"] as const) {
      const choices = stageChoicesFor({ jobType }, STAGES);
      const all = [...choices.forJobType, ...choices.other];

      expect(all).toHaveLength(STAGES.length);
      expect(new Set(codes(all))).toEqual(new Set(codes(STAGES)));
    }
  });

  it("sorts by sequence rather than trusting the order it was handed", () => {
    const shuffled = [...STAGES].reverse();
    const choices = stageChoicesFor({ jobType: "New" }, shuffled);

    expect(codes(choices.forJobType)).toEqual(
      codes([...STAGES].sort((a, b) => a.sequence - b.sequence)),
    );
  });

  it("carries is_optional through without filtering on it", () => {
    // Guidance, not a restriction: the screen marks a stage as one not every
    // job needs, and still offers it.
    const choices = stageChoicesFor({ jobType: "New" }, STAGES);
    const lamination = choices.forJobType.find((s) => s.code === "LAMINATION");

    expect(lamination).toBeDefined();
    expect(lamination!.isOptional).toBe(true);
  });

  it("returns two empty lists for an empty stage table", () => {
    // Reachable: ADMIN can deactivate every stage. It must not throw.
    const choices = stageChoicesFor({ jobType: "New" }, []);

    expect(choices.forJobType).toEqual([]);
    expect(choices.other).toEqual([]);
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
