import type { supplyByEnum } from "@/db/schema/enums";

export type SupplyBy = (typeof supplyByEnum.enumValues)[number];

/**
 * What "Paper supplied by" should show before anybody touches it — section Z,
 * as a pure function.
 *
 * Extracted from the form for the reason `paperCount()` was (F25, J18): this is
 * a three-way rule about when a default is honest, and an argument about it a
 * year from now is far easier to settle against a test than against a rendered
 * dropdown.
 *
 * THE RULE, IN PRECEDENCE ORDER:
 *
 *   1. A STORED ANSWER ALWAYS WINS. Somebody decided this; nothing here
 *      overrides it, on job work or otherwise.
 *   2. RELEASING A CARD FOR JOB WORK offers `Party`. "Job work" means the
 *      client sent the material in, so this is carried by a fact already
 *      entered on the order — not a guess. The person sees it in the dropdown
 *      and can change it before saving, which is what makes a default honest.
 *   3. EVERYTHING ELSE IS BLANK, which is what SupplySelect's own comment
 *      argues for: neither value is a safe guess, and whichever was picked
 *      would be PRINTED on the sheet the floor works from as though somebody
 *      had decided it.
 *
 * WHY MODE IS PART OF IT, and this is the whole reason the function exists
 * rather than an inline `??`. On an EXISTING job-work card whose supply was
 * never recorded, rule 1 finds nothing and rule 2 would fire — so opening that
 * card and saving any other field would write `Party` into a column nobody had
 * answered. That is the backfill W1 and Y2 both refuse, arriving through a form
 * instead of through a migration. Restricting it to release is the fix.
 *
 * PLATE SUPPLY IS DELIBERATELY NOT DEFAULTED. A client who sends board has said
 * nothing about who makes the plate.
 */
export function defaultPaperSupplyBy({
  stored,
  mode,
  isJobWork,
}: {
  /** What the card already says, if it is an existing card. */
  stored?: SupplyBy | string | null;
  mode: "release" | "edit";
  isJobWork?: boolean;
}): SupplyBy | undefined {
  if (stored) return stored as SupplyBy;
  if (mode === "release" && isJobWork) return "Party";
  return undefined;
}

/** Whether the screen should explain a pre-selected value. */
export function paperSupplyWasDefaulted(args: {
  stored?: SupplyBy | string | null;
  mode: "release" | "edit";
  isJobWork?: boolean;
}): boolean {
  return !args.stored && defaultPaperSupplyBy(args) !== undefined;
}
