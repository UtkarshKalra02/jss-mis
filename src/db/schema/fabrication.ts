import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns } from "./_shared";
import { fabricationScopeEnum } from "./enums";
import { design } from "./order";
import { jobCard } from "./production";

/* -------------------------------------------------------------------------- */
/* fabrication_option — the vocabulary                                         */
/* -------------------------------------------------------------------------- */

/**
 * WHAT IS DONE TO THE PAPER, as its own vocabulary.
 *
 * THIS IS NOT THE STAGE LIST, and the distinction is the whole reason this
 * table exists. `stage` answers "where is this job?" — a position on the floor
 * somebody moves an item through. Fabrication answers "what is done to it?" —
 * a specification, decided once, printed on the card.
 *
 * They are not one-to-one and cannot be forced to be. The paper job card this
 * replaces lists THREE laminations (normal, thermal, silver) under what the
 * stage table calls one LAMINATION stage, two UV lines under one UV stage, and
 * four pasting lines under one PASTING stage. It also lists Varnish and
 * Embossing, which have no stage at all. Hanging a detail column off
 * `design_process` could express none of that: there is one row per stage, and
 * "which lamination" needs three.
 *
 * So the route (`design_process`) keeps deciding which STAGES a job passes
 * through, and this decides what is DONE to it. Neither is derived from the
 * other, because on this floor they genuinely are not.
 *
 * SEEDED FROM THE PAPER CARD, verbatim, in migration 0019. It is a table
 * rather than an enum for the same reason `stage` is (C3): the vocabulary
 * belongs to this factory, and a new finishing process should be a row rather
 * than a migration and a deploy.
 */
export const fabricationOption = pgTable(
  "fabrication_option",
  {
    ...baseColumns(),

    /** Stable identifier, referenced from seeds and print layout order. */
    code: text().notNull(),

    /**
     * Printed verbatim on the job card.
     *
     * "N. Lamination" is kept exactly as the paper form writes it. It most
     * likely abbreviates "Normal", as distinct from the Thermal and Silver
     * lamination rows beside it — but that reading is UNCONFIRMED, so the
     * label carries the form's own words rather than an expansion nobody has
     * verified (A2's rule about unmeasured data applies to vocabulary too).
     */
    label: text().notNull(),

    /**
     * Where the VALUE is decided — not where the option is chosen.
     *
     * Whether a design is foiled at all is always a design decision. Whether
     * the foil is gold or silver is too. But new-die-or-old is a fact about
     * THIS RUN: the design does not change between orders, and the die stops
     * being new after the first one. Storing that against the design would
     * print "new die" on every card for the next three years.
     *
     *   Design — the value belongs to the design and is reused every order.
     *   Run    — the value belongs to the job card and is set per run.
     *   None   — the option is a plain tick with no value at all.
     */
    valueScope: fabricationScopeEnum().notNull(),

    /** FOILING's "Other" needs somewhere to say what the other foil was. */
    allowsFreeText: boolean().notNull().default(false),

    /** Print and form order, following the paper card top to bottom. */
    sequence: integer().notNull(),

    isActive: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("fabrication_option_code_key")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index("fabrication_option_sequence_idx").on(t.sequence),
  ],
);

/* -------------------------------------------------------------------------- */
/* fabrication_option_value — the allowed answers                              */
/* -------------------------------------------------------------------------- */

/**
 * The values one option may take: Matt/Gloss, Gold/Silver/Other, New/Old.
 *
 * A CHILD TABLE RATHER THAN A `text[]` COLUMN, and that is load-bearing rather
 * than tidy. With the values as rows, a selection can carry a real foreign key
 * to them — and a COMPOSITE key at that, so the database itself refuses a
 * design claiming "Gold" lamination. An array column could only be checked by
 * a trigger, which is more code enforcing the same rule less directly.
 *
 * Same reasoning that turned `design.processes text[]` into a junction table
 * (C1): a relationship the database can enforce beats one the application
 * remembers to.
 */
export const fabricationOptionValue = pgTable(
  "fabrication_option_value",
  {
    ...baseColumns(),

    optionId: uuid()
      .notNull()
      .references(() => fabricationOption.id, { onDelete: "cascade" }),

    /** Printed as written: "Matt", "Gloss", "Wet", "Gold", "New". */
    value: text().notNull(),

    sequence: integer().notNull(),
  },
  (t) => [
    unique("fabrication_option_value_key").on(t.optionId, t.value),
    /**
     * Redundant on its own — `id` is already the primary key — and required so
     * that a selection can point at (option_id, value_id) as a pair. That is
     * what makes "this value belongs to this option" a foreign key rather than
     * a hope.
     */
    unique("fabrication_option_value_id_option_key").on(t.id, t.optionId),
    index("fabrication_option_value_option_idx").on(t.optionId),
  ],
);

/* -------------------------------------------------------------------------- */
/* design_fabrication — what this design has done to it                        */
/* -------------------------------------------------------------------------- */

/**
 * The design's fabrication specification.
 *
 * One row per option that applies. Design-scope options carry their value
 * here; run-scope ones carry only the tick, and their value arrives on the job
 * card.
 *
 * THE UNIQUE INDEX IS PARTIAL, and that is the fix for F17 rather than a
 * detail. `design_process` carries a FULL unique constraint, so a soft-deleted
 * route row stays visible to it and re-adding a removed process has to RESTORE
 * the old row. Carrying a value on a row with that behaviour would mean
 * removing Foiling and adding it back six months later silently resurrects
 * "Gold" — indistinguishable, on screen and in print, from somebody having
 * chosen it.
 *
 * Here the index is `UNIQUE ... WHERE deleted_at IS NULL`, which is the
 * convention every other natural key in this schema uses (C5). A removed row
 * is invisible to the constraint, so re-adding is a genuine INSERT and the
 * value starts empty. Nothing stale can come back, because there is nothing to
 * come back to.
 */
export const designFabrication = pgTable(
  "design_fabrication",
  {
    ...baseColumns(),

    designId: uuid()
      .notNull()
      .references(() => design.id, { onDelete: "cascade" }),

    optionId: uuid()
      .notNull()
      .references(() => fabricationOption.id),

    /** Null for run-scope options, and for options that take no value. */
    valueId: uuid(),

    /** Only for FOILING → Other. */
    otherText: text(),
  },
  (t) => [
    uniqueIndex("design_fabrication_key")
      .on(t.designId, t.optionId)
      .where(sql`${t.deletedAt} is null`),
    index("design_fabrication_option_idx").on(t.optionId),

    /**
     * The value must belong to the option it is recorded against. Enforced as
     * a composite foreign key rather than in TypeScript, on F11's reasoning: a
     * rule that lives only in the application is a rule the import script does
     * not have and a psql session does not have at all.
     */
    foreignKey({
      columns: [t.valueId, t.optionId],
      foreignColumns: [fabricationOptionValue.id, fabricationOptionValue.optionId],
      name: "design_fabrication_value_fk",
    }),

    check(
      "design_fabrication_other_text_blank_or_set",
      sql`${t.otherText} is null or length(trim(${t.otherText})) > 0`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* job_card_fabrication — what THIS RUN did                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run-scope fabrication values: new die or old, new hybrid UV plate or old,
 * new embossing block or old.
 *
 * These are on the card and not on the design because the design does not
 * change between orders and the tooling does. The first run needs a new die;
 * every run after it uses the same die, older. A flag on the design would be
 * right once and wrong forever after — the failure A2 names for unmeasured
 * numbers, in a different costume.
 *
 * WHICH options appear here is still the design's decision: a design with no
 * embossing never gets asked. This table answers a question the design has
 * already opened.
 */
export const jobCardFabrication = pgTable(
  "job_card_fabrication",
  {
    ...baseColumns(),

    jobCardId: uuid()
      .notNull()
      .references(() => jobCard.id, { onDelete: "cascade" }),

    optionId: uuid()
      .notNull()
      .references(() => fabricationOption.id),

    valueId: uuid(),

    otherText: text(),
  },
  (t) => [
    uniqueIndex("job_card_fabrication_key")
      .on(t.jobCardId, t.optionId)
      .where(sql`${t.deletedAt} is null`),
    index("job_card_fabrication_option_idx").on(t.optionId),

    foreignKey({
      columns: [t.valueId, t.optionId],
      foreignColumns: [fabricationOptionValue.id, fabricationOptionValue.optionId],
      name: "job_card_fabrication_value_fk",
    }),
  ],
);

export type FabricationOption = typeof fabricationOption.$inferSelect;
export type FabricationOptionValue = typeof fabricationOptionValue.$inferSelect;
export type DesignFabrication = typeof designFabrication.$inferSelect;
export type JobCardFabrication = typeof jobCardFabrication.$inferSelect;
