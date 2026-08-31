import { sql } from "drizzle-orm";
import {
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
import { jobCardStatusEnum } from "./enums";
import { poItem } from "./order";
import { stage } from "./reference";
import { appUser } from "./users";

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

export type PressRun = typeof pressRun.$inferSelect;
export type JobCard = typeof jobCard.$inferSelect;
export type StageEvent = typeof stageEvent.$inferSelect;
export type NewStageEvent = typeof stageEvent.$inferInsert;
