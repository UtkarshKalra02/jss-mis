import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns, MONEY } from "./_shared";
import { toolConditionEnum, toolStatusEnum, toolTypeEnum } from "./enums";
import { design } from "./order";
import { client } from "./reference";

/* -------------------------------------------------------------------------- */
/* tooling                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * JOB KITTING — the physical tooling the factory owns: plates, foil blocks,
 * dies and embossing blocks.
 *
 * THE NAME IS A LABEL, NOT A FEATURE (decision I10). "Job Kitting" is what
 * this register is called on screen; it is NOT the BMP kitting gate, which is
 * the check that material, plate, die and artwork are all ready before a job
 * starts. That gate is a future checklist hanging off `job_card` and is
 * recorded in BACKLOG.md. This table answers "where is the die", and nothing
 * in it knows whether a job is ready to run.
 *
 * ONE TABLE WITH A TYPE DISCRIMINATOR, not four near-identical tables
 * (decision I1). Every question anybody actually asks of a piece of tooling is
 * the same question for all four kinds: where is it, what condition is it in,
 * whose job is it for, what replaced it. Four tables would mean four screens,
 * four queries, and four places to forget a filter — and the day somebody wants
 * "everything in rack 3" they would need a union of all four.
 *
 * THE FIELD THIS TABLE EXISTS FOR IS `location`. The register is consulted far
 * more often to answer "where is the die for X" than for anything else, which
 * is why it is required on everything that has arrived, why it appears in the
 * grid without opening a row, and why the whole register works on a phone.
 *
 * NO ISSUE/RETURN WORKFLOW (I5). `status` is set by hand. A checkout system
 * would be a daily-discipline burden nobody agreed to carry, and a half-kept
 * one is worse than none because it still looks authoritative.
 */
export const tooling = pgTable(
  "tooling",
  {
    ...baseColumns(),

    /** PLT/FBL/DIE/EMB-YYYY-NNNN, from the shared allocator (C7, I2). */
    toolNo: text().notNull(),

    toolType: toolTypeEnum().notNull(),

    /**
     * The design this tooling was made for, when it was made for one.
     *
     * Nullable because some tooling is generic. Note the cardinality: a tool
     * belongs to at most ONE design, so "which designs use it" is at most one
     * answer (I4). Tooling genuinely shared between designs would need a
     * junction table, which is a deliberate later change rather than something
     * to assume.
     */
    designId: uuid().references(() => design.id),

    /**
     * Whose tooling it is.
     *
     * DERIVED FROM THE DESIGN whenever a design is linked, and enforced by a
     * database trigger rather than only in the action (migration 0015, I3). A
     * tool pointing at one client's design while naming another client is the
     * kind of disagreement nobody notices until a die is sent to the wrong
     * customer, and the rule has to hold for a psql session too (F11).
     *
     * Still stored rather than always derived, because tooling with no design
     * can still belong to a client.
     */
    clientId: uuid().references(() => client.id),

    /** What it is, in Punit's words. "OLD DIE (FERTILINA TAB 60)". */
    name: text().notNull(),

    size: text(),

    /**
     * Meaningful mainly for plates, and NOT constrained to them.
     *
     * A CHECK restricting this to PLATE was considered and rejected (I6): foil
     * blocks have a foil colour, and a rule that is wrong on the floor gets
     * worked around rather than reported. The form hides the field for types
     * where it usually means nothing; the database stays permissive.
     */
    colour: text(),

    /**
     * Ink and Pantone reference.
     *
     * Meaningful mainly for plates, and NOT constrained to them, on exactly
     * the reasoning already recorded for `colour` in I6: a CHECK restricting
     * these to PLATE would be wrong the first time somebody records the ink a
     * foil block runs with, and a rule that is wrong on the floor gets worked
     * around rather than reported. The form offers them where they usually
     * mean something; the database stays permissive.
     */
    ink: text(),
    pantoneNo: text(),

    /**
     * Rack / almirah / shelf. The most-read field in the whole table.
     *
     * NULLABLE FOR EXACTLY ONE REASON (I11): a tool that has been ordered from
     * a vendor and has not arrived has no location, and that is a fact rather
     * than missing data. The CHECK below requires it for every other status,
     * so the moment somebody marks a die as In House the database refuses to
     * save without saying where it went — the receiving step enforces itself
     * rather than relying on discipline.
     *
     * This is F8's shape exactly: nullable in the schema for one narrow,
     * documented case, required at every other point, and rendered as a
     * sentence ("On order") rather than a blank cell wherever it is null.
     */
    location: text(),

    condition: toolConditionEnum().notNull().default("Good"),
    status: toolStatusEnum().notNull().default("In House"),

    madeDate: date(),
    vendor: text(),
    cost: numeric(MONEY),

    /**
     * Manual entry. There is no automatic impression counting anywhere in this
     * system and nothing here implies there is — a number that looks measured
     * and is typed is worse than a blank (A2's reasoning).
     */
    impressionsUsed: integer(),

    lastUsedDate: date(),

    /**
     * The tool this one replaced.
     *
     * The v1 data already carries entries like "OLD DIE (FERTILINA TAB 60)",
     * so old and new versions of the same tooling coexist informally today.
     * This makes that relationship explicit and directional: each row points
     * BACK at what it superseded, so the chain reads newest-first and adding a
     * replacement never edits the row being replaced.
     */
    replacesToolId: uuid().references((): AnyPgColumn => tooling.id),

    remarks: text(),
  },
  (t) => [
    uniqueIndex("tooling_no_key")
      .on(t.toolNo)
      .where(sql`${t.deletedAt} is null`),

    index("tooling_type_idx").on(t.toolType),
    index("tooling_design_idx").on(t.designId),
    index("tooling_client_idx").on(t.clientId),
    index("tooling_status_idx").on(t.status),
    index("tooling_condition_idx").on(t.condition),
    index("tooling_replaces_idx").on(t.replacesToolId),
    // "What is in rack 3" is a real question and deserves an index.
    index("tooling_location_idx").on(t.location),

    /** A tool cannot replace itself. The cheapest half of cycle safety. */
    check("tooling_not_self_replacing", sql`${t.replacesToolId} is null or ${t.replacesToolId} <> ${t.id}`),

    check(
      "tooling_impressions_non_negative",
      sql`${t.impressionsUsed} is null or ${t.impressionsUsed} >= 0`,
    ),
    check("tooling_cost_non_negative", sql`${t.cost} is null or ${t.cost} >= 0`),

    /**
     * A blank location is the one thing that makes this register useless —
     * unless the tool is not here yet (I11). Ordered rows may have none; every
     * other status must, and it may never be whitespace.
     */
    check(
      "tooling_location_present_unless_ordered",
      sql`(${t.status} = 'Ordered' and (${t.location} is null or length(trim(${t.location})) > 0))
          or (${t.location} is not null and length(trim(${t.location})) > 0)`,
    ),
    check("tooling_name_not_blank", sql`length(trim(${t.name})) > 0`),
  ],
);

export type Tooling = typeof tooling.$inferSelect;
export type NewTooling = typeof tooling.$inferInsert;
