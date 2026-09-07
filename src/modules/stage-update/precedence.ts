export type StageOption = {
  code: string;
  name: string;
  colour: string;
  sequence: number;
  isOptional: boolean;
  appliesTo: "All" | "New" | "Repeat";
};

export type StageChoices = {
  /** The stages a job of this type goes through, in sequence order. */
  forJobType: StageOption[];
  /**
   * Everything else, still selectable. F18: Preeti has to be able to move a job
   * to READY and DISPATCHED, and neither is a step for either job type.
   */
  other: StageOption[];
};

/**
 * Which stages to offer for one item — decision F4, as a pure function.
 *
 * Extracted from the screen so it can be tested without a database, a session
 * or a browser, the same reasoning that pulled the stage-config diff out into
 * its own file (E14). This is the rule most likely to be argued about later,
 * and an argument is much easier to settle against a test than against a
 * component.
 *
 * ONE SOURCE, NOT THREE. `stage.applies_to` filtered by the item's `job_type`
 * (B4) — the JOB's type, not the client's. A repeat run skips ENQUIRY and
 * COSTING; a genuinely new job from a long-standing client does not.
 *
 * F4 originally put a per-design route (`design_process`) above this, and J22
 * removed it: no design ever differed from its job type's default, so the route
 * was a screen full of checkboxes nobody set and a branch nothing took.
 * `is_optional` still narrows neither list — it is carried through so the
 * screen can mark a stage as one not every job needs, which is guidance rather
 * than a restriction.
 *
 * NOTHING IS EVER REMOVED FROM THE DROPDOWN (F18). Stages outside the job
 * type's own come back in `other`, because a rule that hides a stage somebody
 * needs at 6pm gets worked around, and the workaround is worse than the wrong
 * order.
 */
export function stageChoicesFor(
  args: { jobType: "New" | "Repeat" },
  allStages: readonly StageOption[],
): StageChoices {
  const bySequence = [...allStages].sort((a, b) => a.sequence - b.sequence);

  const applies = (s: StageOption) => s.appliesTo === "All" || s.appliesTo === args.jobType;

  return {
    forJobType: bySequence.filter(applies),
    other: bySequence.filter((s) => !applies(s)),
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
