import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { baseColumns } from "./_shared";
import { jobCardStatusEnum, supplyByEnum } from "./enums";
import { poItem } from "./order";
import { stage } from "./reference";
import { appUser } from "./users";

/* -------------------------------------------------------------------------- */
/* machine                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The presses. A short, seeded list the job card ticks one of.
 *
 * This started as free text on `job_card`, on the reasoning that there was no
 * machine master and inventing one would be a table nobody maintains. The
 * paper job card settled it: Machine Detail there is a printed TICK LIST of
 * the actual presses, not a blank. A master exists — it has just been on
 * paper.
 *
 * A TABLE RATHER THAN AN ENUM, for the reason stages are a table (C3): the
 * list belongs to this factory and changes when a press is bought or sold,
 * which should be a row rather than a migration and a deploy.
 */
export const machine = pgTable(
  "machine",
  {
    ...baseColumns(),

    code: text().notNull(),

    /** As the floor says it: "SM-72 — 6 Colour". */
    name: text().notNull(),

    /** Sheet size the press takes, printed beside the name: 20" x 28.5". */
    sheetSize: text(),

    sequence: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("machine_code_key")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index("machine_sequence_idx").on(t.sequence),
  ],
);

/* -------------------------------------------------------------------------- */
/* press_run                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One trip through the press — a plate that ran on a machine on a day.
 *
 * Exists to represent GANGING: three to eight times a month, items from
 * DIFFERENT clients are printed together on one plate to fill a sheet. Until
 * now the system could not say so, so the Item Tracker implied every job ran
 * standalone, which was false about roughly one job in twenty.
 *
 * IT SITS ABOVE JOB CARDS, NOT BELOW THEM. `job_card.po_item_id` is unchanged
 * and still NOT NULL: one job card is still exactly one PO item (spec section
 * 3). What ganging adds is that several job cards may point at the same press
 * run. Nothing about the one-item-per-card rule is loosened — see decision H1.
 *
 * CROSS-CLIENT IS THE POINT, and this table therefore has NO client column and
 * NO cross-client constraint. The triggers from migration 0001 that refuse a
 * mixed-client dispatch or invoice (C8) deliberately do not extend here: on a
 * challan a second client is a mistake, and on a plate it is the whole reason
 * the plate exists. Anybody later "fixing" that inconsistency would be breaking
 * this feature (H3).
 *
 * There is deliberately no status column. See H5: "open" on the add-to-run
 * screen means RECENT, because a press run is a thing that happened on a date
 * rather than a thing that is open or closed, and inventing a lifecycle nobody
 * asked for is how a minority-case feature grows a workflow.
 */
export const pressRun = pgTable(
  "press_run",
  {
    ...baseColumns(),

    /** PR-YYYY-NNNN, financial year, from the shared allocator (C7). */
    runNo: text().notNull(),

    runDate: date().notNull(),

    /**
     * Free text, and nullable, because there is no machine master to reference.
     * A text column that is honest about being a note beats a foreign key to a
     * table that does not exist.
     */
    machine: text(),

    notes: text(),
  },
  (t) => [
    uniqueIndex("press_run_no_key")
      .on(t.runNo)
      .where(sql`${t.deletedAt} is null`),
    index("press_run_date_idx").on(t.runDate),
  ],
);

/* -------------------------------------------------------------------------- */
/* job_card                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One job card covers exactly ONE po_item, but a po_item may have several job
 * cards — repeat runs and split runs.
 *
 * Since press runs (H1) a job card may ALSO belong to a gang, which is a
 * grouping above this table rather than a loosening of it: po_item_id is still
 * NOT NULL and still singular.
 */
export const jobCard = pgTable(
  "job_card",
  {
    ...baseColumns(),

    /** JC-YYYY-NNNN, financial year. */
    jcNo: text().notNull(),

    poItemId: uuid()
      .notNull()
      .references(() => poItem.id),

    /** May be less than ordered_qty when a run is split. */
    plannedQty: integer(),

    /** Which day it is scheduled to run. */
    plannedDate: date(),

    status: jobCardStatusEnum().notNull().default("Planned"),
    holdReason: text(),
    notes: text(),

    /* ---------------------------------------------------------------------- */
    /* The printed card                                                        */
    /* ---------------------------------------------------------------------- */

    /**
     * Who supplies the paper, and who supplies the plate.
     *
     * Both nullable, because both are genuinely unknown on a card released
     * before anybody has decided — and a default of 'Press' would be a guess
     * printed as a fact on the sheet the floor works from.
     */
    paperSupplyBy: supplyByEnum(),
    plateSupplyBy: supplyByEnum(),

    /** The plate's own identifier, as the party or the platemaker gave it. */
    plateJobId: text(),

    /**
     * Which press. A tick on the paper card, so a foreign key here.
     *
     * Replaced the free-text `machine_detail` this table carried for two days:
     * the paper job card prints a tick list of the actual presses, which means
     * the machine master the free text was excused by does exist. See J10.
     */
    machineId: uuid().references(() => machine.id),

    /* ---------------------------------------------------------------------- */
    /* Typed in when the card is made — the pen-written half of the paper form  */
    /* ---------------------------------------------------------------------- */

    /**
     * The card's top-left check list: paper, plates, colour.
     *
     * Three ticks that are, on paper, the readiness gate the BMP calls kitting
     * — is the material here, is the plate made, is the colour settled. They
     * are recorded, not enforced: nothing refuses to print a card with all
     * three clear, because the paper form never did either (J11).
     */
    checklistPaper: boolean().notNull().default(false),
    checklistPlates: boolean().notNull().default(false),
    checklistColour: boolean().notNull().default(false),

    /**
     * The card's PAPER DETAIL band.
     *
     * NOT derived from the design, and that is not duplication. `design.job_size`
     * is the FINISHED size of the job; `paper_size` here is the parent sheet the
     * run prints on — 25" x 36" against a carton a fraction of that. They are
     * different facts about different things, and the sheet is a decision made
     * per run out of what stock is in the building.
     */
    paperSize: text(),
    paperGsm: text(),
    paperFinish: text(),
    sheetsPerReam: integer(),
    paperRemarks: text(),

    /**
     * The card's JOB EXECUTION band, minus the three that stay blank.
     *
     * Number of colours, the size run, and the planning note are all decided
     * before the sheet is printed and are therefore printed on it. Final
     * quantity, wastage and the execution remark are the only things on the
     * page left empty (J4).
     */
    execNoOfColours: text(),
    execSize: text(),
    execPlanning: text(),

    /** The card's Fabrication Detail remarks line. Printed, not hand-written. */
    fabricationRemarks: text(),

    /* ---------------------------------------------------------------------- */
    /* Transcribed back from the paper card after the run                      */
    /* ---------------------------------------------------------------------- */

    /**
     * WRITTEN BY HAND ON THE FLOOR FIRST, then typed in.
     *
     * These three are the only fields on this table that exist to be filled in
     * AFTER the card has been printed and worked from. The printed card leaves
     * them blank on purpose (decision J4) — the numbers do not exist when the
     * sheet goes out — and somebody transcribes them afterwards so the record
     * is not only on paper.
     *
     * `final_qty` is NOT capped at planned_qty. Over-runs are ordinary on a
     * press, and a constraint that refuses the true number would be answered
     * by typing a false one.
     */
    finalQty: integer(),
    wastageQty: integer(),
    executionRemarks: text(),

    /**
     * The gang this card was printed in, when it was ganged at all.
     *
     * NULLABLE, and that is the design rather than a convenience: the
     * overwhelming majority of job cards are not ganged and must stay exactly
     * as they were. A null here means "printed on its own", which is both the
     * common case and the honest default for every card that already exists.
     */
    pressRunId: uuid().references(() => pressRun.id),
  },
  (t) => [
    uniqueIndex("job_card_no_key")
      .on(t.jcNo)
      .where(sql`${t.deletedAt} is null`),
    index("job_card_po_item_idx").on(t.poItemId),
    index("job_card_press_run_idx").on(t.pressRunId),
    index("job_card_planned_date_idx").on(t.plannedDate),
    index("job_card_status_idx").on(t.status),

    check(
      "job_card_planned_qty_positive",
      sql`${t.plannedQty} is null or ${t.plannedQty} > 0`,
    ),
    // A job card on hold without a reason is a job card nobody can unblock.
    check(
      "job_card_hold_reason_required",
      sql`${t.status} <> 'On Hold' or (${t.holdReason} is not null and length(trim(${t.holdReason})) > 0)`,
    ),

    // Non-negative, and nothing more. A ceiling on final_qty would refuse a
    // genuine over-run; see the column comment.
    check("job_card_final_qty_non_negative", sql`${t.finalQty} is null or ${t.finalQty} >= 0`),
    check(
      "job_card_wastage_qty_non_negative",
      sql`${t.wastageQty} is null or ${t.wastageQty} >= 0`,
    ),
    check(
      "job_card_sheets_per_ream_positive",
      sql`${t.sheetsPerReam} is null or ${t.sheetsPerReam} > 0`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* stage_event — APPEND ONLY                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The source of truth for where anything is.
 *
 * NEVER UPDATE OR DELETE A ROW IN THIS TABLE. `current_stage` is derived by
 * taking the latest event per po_item (non-negotiable 1). If these rows are
 * mutable, the stage history stops being a history and OTD investigations
 * become unanswerable — "it says PRINTING now, but when did it get there?"
 *
 * Corrections are made by appending a new event, not by editing an old one.
 *
 * Deliberately does not use baseColumns(): no updated_at, no updated_by, no
 * deleted_at, because none of those operations are permitted here (C6).
 */
export const stageEvent = pgTable(
  "stage_event",
  {
    id: uuid().primaryKey().defaultRandom(),

    poItemId: uuid()
      .notNull()
      .references(() => poItem.id),

    jobCardId: uuid().references(() => jobCard.id),

    stageCode: text()
      .notNull()
      .references(() => stage.code),

    /**
     * When it ACTUALLY happened on the floor, not when someone got round to
     * typing it. These differ routinely — Ajay updates stages in batches — and
     * WIP ageing is wrong if you use the typing time.
     */
    eventAt: timestamp({ withTimezone: true }).notNull(),

    enteredBy: uuid().references(() => appUser.id),
    remarks: text(),

    /** When the row was written. Kept alongside event_at precisely because
     *  the two are not the same thing and the gap is sometimes evidence. */
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Spec section 4.4. This index is what makes "latest event per item"
    // fast, and every derived stage lookup depends on it.
    index("stage_event_po_item_event_at_idx").on(t.poItemId, t.eventAt.desc()),
    index("stage_event_stage_code_idx").on(t.stageCode),
    index("stage_event_job_card_idx").on(t.jobCardId),
  ],
);

export type Machine = typeof machine.$inferSelect;
export type PressRun = typeof pressRun.$inferSelect;
export type JobCard = typeof jobCard.$inferSelect;
export type StageEvent = typeof stageEvent.$inferSelect;
export type NewStageEvent = typeof stageEvent.$inferInsert;
