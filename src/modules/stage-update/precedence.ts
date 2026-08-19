export type StageOption = {
  code: string;
  name: string;
  colour: string;
  sequence: number;
  isOptional: boolean;
  appliesTo: "All" | "New" | "Repeat";
};

export type StageChoices = {
  /** The stages this job actually goes through, in sequence order. */
  route: StageOption[];
  /**
   * Everything else, still selectable. F18: Preeti has to be able to move a job
   * to READY and DISPATCHED, and neither is a route step.
   */
  other: StageOption[];
  /** Why `route` contains what it contains — shown as a hint on the screen. */
  basis: "design" | "jobType";
};

/**
 * Which stages to offer for one item — decision F4's precedence, as a pure
 * function.
 *
 * Extracted from the screen so it can be tested without a database, a session
 * or a browser, the same reasoning that pulled the stage-config diff out into
 * its own file (E14). This is the rule most likely to be argued about later,
 * and an argument is much easier to settle against a test than against a
 * component.
 *
 * The precedence, highest first:
 *
 *   1. The DESIGN's route (`design_process`), when the design has one. A route
 *      is a statement about how this particular job is manufactured, and it is
 *      more specific than anything derived from the job's type.
 *   2. Otherwise `stage.applies_to`, filtered by the item's `job_type` (B4) —
 *      the JOB's type, not the client's. A repeat run skips ENQUIRY and
 *      COSTING; a genuinely new job from a long-standing client does not.
 *   3. `is_optional` narrows neither list. It is carried through so the screen
 *      can mark a stage as one not every job needs, which is guidance rather
 *      than a restriction.
 *
 * NOTHING IS EVER REMOVED FROM THE DROPDOWN (F18). Stages outside the route
 * come back in `other`, because a rule that hides a stage somebody needs at 6pm
 * gets worked around, and the workaround is worse than the wrong order.
 */
export function stageChoicesFor(
  args: {
    jobType: "New" | "Repeat";
    /** Stage codes from design_process. Empty when the design has no route. */
    routeCodes: readonly string[];
  },
  allStages: readonly StageOption[],
): StageChoices {
  const bySequence = [...allStages].sort((a, b) => a.sequence - b.sequence);

  const hasDesignRoute = args.routeCodes.length > 0;

  const inRoute = hasDesignRoute
    ? (s: StageOption) => args.routeCodes.includes(s.code)
    : (s: StageOption) => s.appliesTo === "All" || s.appliesTo === args.jobType;

  return {
    route: bySequence.filter(inRoute),
    other: bySequence.filter((s) => !inRoute(s)),
    basis: hasDesignRoute ? "design" : "jobType",
  };
}

/**
 * Whether moving to `target` is a step BACKWARDS for an item currently at
 * `current`.
 *
 * Backward moves are allowed (F4) — rework is real on a shop floor, and a
 * system that cannot express it gets worked around. They are confirmed rather
 * than blocked, so the confirmation needs to know when to appear.
 *
 * An item with no current stage cannot move backwards, and neither can one
 * whose current stage has been removed from the table — in both cases there is
 * no sequence to compare against, and inventing a confirmation for a comparison
 * that was not made would train people to click through them.
 */
export function isBackwardMove(
  currentSequence: number | null | undefined,
  targetSequence: number,
): boolean {
  if (currentSequence === null || currentSequence === undefined) return false;
  return targetSequence < currentSequence;
}
