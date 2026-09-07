import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import {
  designFabrication,
  fabricationOption,
  fabricationOptionValue,
  jobCardFabrication,
} from "@/db/schema";

/**
 * The fabrication vocabulary, and what a design or a job card has chosen from
 * it.
 *
 * Everything here reads the vocabulary from the DATABASE rather than a list in
 * a component — non-negotiable 5, the same rule that keeps stage colours off
 * the stage pill. A finishing process the factory adds appears on the design
 * form and on the printed card with no change to any file.
 */

type Runner = typeof db | Tx;

export type OptionValue = { id: string; value: string; sequence: number };

export type FabricationOptionRow = {
  id: string;
  code: string;
  label: string;
  valueScope: "Design" | "Run" | "None";
  allowsFreeText: boolean;
  sequence: number;
  values: OptionValue[];
};

/**
 * Every active option, in the paper card's order, with its allowed values.
 *
 * One query and a group-by rather than a query per option: the vocabulary is
 * thirteen rows and is read on the design form, the job card and the print, so
 * it should cost one round trip wherever it is needed.
 */
export async function fabricationVocabulary(
  runner: Runner = db,
): Promise<FabricationOptionRow[]> {
  const rows = await runner
    .select({
      id: fabricationOption.id,
      code: fabricationOption.code,
      label: fabricationOption.label,
      valueScope: fabricationOption.valueScope,
      allowsFreeText: fabricationOption.allowsFreeText,
      sequence: fabricationOption.sequence,
      valueId: fabricationOptionValue.id,
      value: fabricationOptionValue.value,
      valueSequence: fabricationOptionValue.sequence,
    })
    .from(fabricationOption)
    .leftJoin(
      fabricationOptionValue,
      and(
        eq(fabricationOptionValue.optionId, fabricationOption.id),
        isNull(fabricationOptionValue.deletedAt),
      ),
    )
    .where(and(isNull(fabricationOption.deletedAt), eq(fabricationOption.isActive, true)))
    .orderBy(asc(fabricationOption.sequence), asc(fabricationOptionValue.sequence));

  const byOption = new Map<string, FabricationOptionRow>();

  for (const row of rows) {
    let option = byOption.get(row.id);
    if (!option) {
      option = {
        id: row.id,
        code: row.code,
        label: row.label,
        valueScope: row.valueScope,
        allowsFreeText: row.allowsFreeText,
        sequence: row.sequence,
        values: [],
      };
      byOption.set(row.id, option);
    }
    // An option with no values at all is a plain tick (scope 'None'), so the
    // left join legitimately produces a null row for it.
    if (row.valueId && row.value !== null) {
      option.values.push({ id: row.valueId, value: row.value, sequence: row.valueSequence! });
    }
  }

  return [...byOption.values()];
}

export type Selection = {
  optionId: string;
  valueId: string | null;
  otherText: string | null;
  /**
   * Whether the job has this process. Always true for a design's selections —
   * a design records only what it HAS — and either way for a card, which can
   * say a job does not have something its design ticked (J24).
   */
  applies: boolean;
};

/** What one design has chosen. Keyed by option id for the form and the print. */
export async function designSelections(
  designId: string,
  runner: Runner = db,
): Promise<Map<string, Selection>> {
  const rows = await runner
    .select({
      optionId: designFabrication.optionId,
      valueId: designFabrication.valueId,
      otherText: designFabrication.otherText,
    })
    .from(designFabrication)
    .where(and(eq(designFabrication.designId, designId), isNull(designFabrication.deletedAt)));

  // A design row exists only for a process the design HAS, so presence is the
  // whole statement. The card is the one that can say "not on this job".
  return new Map(rows.map((r) => [r.optionId, { ...r, applies: true }]));
}

/** What one job card has recorded. Since J24 that is the whole block. */
export async function jobCardSelections(
  jobCardId: string,
  runner: Runner = db,
): Promise<Map<string, Selection>> {
  const rows = await runner
    .select({
      optionId: jobCardFabrication.optionId,
      valueId: jobCardFabrication.valueId,
      otherText: jobCardFabrication.otherText,
      applies: jobCardFabrication.applies,
    })
    .from(jobCardFabrication)
    .where(and(eq(jobCardFabrication.jobCardId, jobCardId), isNull(jobCardFabrication.deletedAt)));

  return new Map(rows.map((r) => [r.optionId, r]));
}

export type PrintedFabricationLine = {
  optionId: string;
  code: string;
  label: string;
  /** Whether this design has the process at all. */
  applies: boolean;
  /**
   * What to print beside the label: "Matt", "Gold", "New", or "Gold — copper
   * tint" where free text was given. Null when the option takes no value.
   */
  detail: string | null;
  /** True when the value is missing and somebody still has to answer it. */
  awaitingValue: boolean;
  /**
   * Where this line's answer came from. Null when nothing has been said about
   * it anywhere. The card wins wherever it has an opinion (J24).
   */
  source: "design" | "card" | null;
  /**
   * True when the card disagrees with the design — a different value, or a
   * process turned on or off. This is the flag that makes the accepted risk
   * visible: two places can answer this question and the screen has to say
   * which one did.
   */
  overridesDesign: boolean;
};

/**
 * The fabrication checklist exactly as the job card prints it.
 *
 * EVERY option is returned, applying or not, because the paper form this
 * replaces prints all of them and the floor reads the shape as much as the
 * ticks. What has changed is that a ticked line now carries its ANSWER —
 * "Foiling ✓ Gold" — where the paper card carried a ruled blank for somebody
 * to write it in.
 *
 * THE CARD WINS, PER OPTION (J24). Where the card has said anything about an
 * option — has it, does not have it, or what value — that is the answer. Where
 * it has said nothing, the design's answer stands. The design is a default and
 * the card is the document that goes to the floor.
 *
 * This deliberately allows two places to answer one question, which is the
 * failure I7 deleted `design.die_id` over. It is accepted here on one
 * condition, and `source` and `overridesDesign` are that condition: every line
 * says where its answer came from, and a line where the card contradicts its
 * design says so rather than quietly winning.
 *
 * The value falls through separately from the tick. A card that turns Foiling
 * on without saying Gold or Silver, on a design that says Gold, prints Gold —
 * the card overrode the tick and said nothing about the value, so there is no
 * disagreement to resolve.
 */
export function printedChecklist(
  vocabulary: readonly FabricationOptionRow[],
  design: ReadonlyMap<string, Selection>,
  card: ReadonlyMap<string, Selection>,
  opts: {
    /**
     * Whether the item HAS a design at all.
     *
     * An empty design map means two different things and only the caller knows
     * which: an item with no design linked to it, which is most of them, or a
     * design that has no fabrication ticked. Without the distinction every
     * ordinary card would report itself as overriding a design that does not
     * exist, and a warning that fires on everything is one nobody reads.
     */
    hasDesign?: boolean;
  } = {},
): PrintedFabricationLine[] {
  const hasDesign = opts.hasDesign ?? design.size > 0;

  const valueLabel = new Map<string, string>();
  for (const option of vocabulary) {
    for (const v of option.values) valueLabel.set(v.id, v.value);
  }

  return vocabulary.map((option) => {
    const fromDesign = design.get(option.id);
    const fromCard = card.get(option.id);

    // The tick: the card's opinion if it has one, otherwise the design's.
    const applies = fromCard ? fromCard.applies : fromDesign !== undefined;

    const saidByCard = fromCard !== undefined;
    const designApplies = fromDesign !== undefined;

    if (!applies || option.valueScope === "None") {
      return {
        optionId: option.id,
        code: option.code,
        label: option.label,
        applies,
        detail: null,
        awaitingValue: false,
        source: applies ? (saidByCard ? "card" : "design") : null,
        overridesDesign: hasDesign && saidByCard && fromCard.applies !== designApplies,
      };
    }

    // The value: the card's if it gave one, otherwise the design's. A card
    // that ticked a process without answering it has not contradicted a design
    // that did answer it.
    const valued = fromCard?.valueId ? fromCard : (fromDesign?.valueId ? fromDesign : fromCard);
    const value = valued?.valueId ? (valueLabel.get(valued.valueId) ?? null) : null;

    const detail = value && valued?.otherText ? `${value} — ${valued.otherText}` : (value ?? null);

    const valueFromCard = Boolean(fromCard?.valueId);

    return {
      optionId: option.id,
      code: option.code,
      label: option.label,
      applies: true,
      detail,
      /*
       * Ticked, and nobody has said which. The card must not print a blank
       * rule for this — the answer belongs in the system (J8) — so the screen
       * flags it before the sheet is printed instead.
       */
      awaitingValue: detail === null,
      source: valueFromCard || saidByCard ? "card" : "design",
      overridesDesign:
        hasDesign &&
        saidByCard &&
        (fromCard.applies !== designApplies ||
          (valueFromCard && fromDesign?.valueId != null && fromCard.valueId !== fromDesign.valueId)),
    };
  });
}
