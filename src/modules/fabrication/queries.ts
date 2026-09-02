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

  return new Map(rows.map((r) => [r.optionId, r]));
}

/** What one job card has recorded for the run-scope options. */
export async function jobCardSelections(
  jobCardId: string,
  runner: Runner = db,
): Promise<Map<string, Selection>> {
  const rows = await runner
    .select({
      optionId: jobCardFabrication.optionId,
      valueId: jobCardFabrication.valueId,
      otherText: jobCardFabrication.otherText,
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
 * Design-scope values come from the design, run-scope values from the card.
 * That split is the whole reason both tables exist: gold-or-silver is a
 * property of the design and is right every time it is ordered, while
 * new-die-or-old is a property of this run and would be wrong on the second.
 */
export function printedChecklist(
  vocabulary: readonly FabricationOptionRow[],
  design: ReadonlyMap<string, Selection>,
  card: ReadonlyMap<string, Selection>,
): PrintedFabricationLine[] {
  const valueLabel = new Map<string, string>();
  for (const option of vocabulary) {
    for (const v of option.values) valueLabel.set(v.id, v.value);
  }

  return vocabulary.map((option) => {
    const chosen = design.get(option.id);
    const applies = chosen !== undefined;

    if (!applies || option.valueScope === "None") {
      return {
        optionId: option.id,
        code: option.code,
        label: option.label,
        applies,
        detail: null,
        awaitingValue: false,
      };
    }

    const source = option.valueScope === "Run" ? card.get(option.id) : chosen;
    const value = source?.valueId ? (valueLabel.get(source.valueId) ?? null) : null;

    const detail =
      value && source?.otherText ? `${value} — ${source.otherText}` : (value ?? null);

    return {
      optionId: option.id,
      code: option.code,
      label: option.label,
      applies: true,
      detail,
      /*
       * A run-scope option on a design that has it, with nobody having said
       * new or old yet. The card must not print a blank rule for this — the
       * answer belongs in the system (J8) — so the screen flags it before the
       * sheet is printed instead.
       */
      awaitingValue: detail === null,
    };
  });
}
