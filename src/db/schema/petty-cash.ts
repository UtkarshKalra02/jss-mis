import { sql } from "drizzle-orm";
import {
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
import { pettyCashDirectionEnum } from "./enums";

/**
 * Petty cash — the tin in the office, and the only money ledger in this system.
 *
 * WHY THIS EXISTS AT ALL, given decision R1. R1 dropped invoices, receipts, AR
 * and the vendor bill on the grounds that "postings belong where the accountant
 * already makes them", and Busy is the book of record for accounts. Petty cash
 * is the one exception, asked for by Utkarsh on 20 Nov 2026 and confirmed in the
 * same breath: the tin is NOT in Busy. It was a notebook. So this is not a
 * second copy of a Busy ledger — it is the first copy of something that had no
 * ledger, which is the whole of why R1 does not bite. See DECISIONS.md CC1.
 *
 * WHAT IT IS NOT. No GST, no vendor ledger, no link to an invoice, no bank
 * side. It answers one question — how much is in the tin, and where did the
 * rest go — and stops.
 */

/* -------------------------------------------------------------------------- */
/* petty_cash_head                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What the money went on. Seeded configuration, like `stage`, not an enum.
 *
 * FIXED HEADS RATHER THAN FREE TEXT, Utkarsh's call on 20 Nov 2026, and the
 * reason is arithmetic: a month cannot be totalled by head if the head is
 * typed. "Conveyance", "conveyence" and "auto" are three heads to a database
 * and one to a person, and the by-head view would be useless within a fortnight.
 *
 * A TABLE RATHER THAN A pgEnum, for the same reason stages are a table: this is
 * the kind of list that grows when the factory's spending changes, and growing
 * an enum needs a migration while growing a table needs a row. Heads are
 * deactivated by soft delete, never removed, so an old entry's head still reads.
 */
export const pettyCashHead = pgTable(
  "petty_cash_head",
  {
    ...baseColumns(),

    /**
     * IMMUTABLE once created. Nothing references it by value today — entries
     * point at `id` — but the seed and the tests name heads by code, and a code
     * that changes meaning is the kind of silent rewrite C2 forbids on stages.
     */
    code: text().notNull(),
    name: text().notNull(),

    /** Display order on the form and in the by-head total. */
    sequence: integer().notNull(),
  },
  (t) => [
    uniqueIndex("petty_cash_head_code_key")
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index("petty_cash_head_sequence_idx").on(t.sequence),
  ],
);

/* -------------------------------------------------------------------------- */
/* petty_cash                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One row per movement of cash, in or out.
 *
 * NO BALANCE COLUMN, and this is the point. The balance is
 * `petty_cash_balance_on(date)` and the day's sheet is `v_petty_cash_day`,
 * both derived — non-negotiable 2's reasoning applied to money. A stored
 * closing balance is right on the day it is written and wrong the first time
 * somebody backdates an entry or voids one, and it looks equally authoritative
 * on both days. There is also no opening-float setting: the book starts empty
 * and the first top-up IS the float, so there is no second place for the
 * starting figure to be wrong.
 *
 * NO UPDATE PATH. An entry is added or voided, never edited, so there is no
 * `updatePettyCashAction` and the audit wrapper's OWNER carve-out deliberately
 * does not grant one. A wrong amount is voided and re-entered, which leaves
 * both the mistake and the correction visible — the discipline a cash book is
 * for.
 */
export const pettyCash = pgTable(
  "petty_cash",
  {
    ...baseColumns(),

    /**
     * THE DAY THE CASH MOVED, which is not the day it was typed.
     *
     * Entries are written up the next morning, exactly as stage updates are,
     * so `created_at` answers a different question and must not be used for the
     * sheet. Every balance in this module is keyed on this column.
     */
    entryDate: date().notNull(),

    direction: pettyCashDirectionEnum().notNull(),

    /** Always positive. The direction carries the sign, not the figure. */
    amount: numeric(MONEY).notNull(),

    /**
     * Required on the way OUT, refused on the way IN.
     *
     * Money arriving in the tin is a top-up and has no head — "conveyance" is
     * not where it came from. Allowing one anyway would put top-ups in the
     * by-head spend total, which is the one number this table exists to
     * produce.
     */
    headId: uuid().references(() => pettyCashHead.id),

    /** Paid to, on the way out; received from, on the way in. */
    party: text(),

    /** What it was for, in the words of whoever handed the money over. */
    purpose: text().notNull(),
  },
  (t) => [
    /*
     * Explicit IS NULL / IS NOT NULL on every term, the 0046 lesson: a CHECK
     * PASSES when its expression evaluates to NULL, so a pairing rule written
     * without them is not a rule.
     */
    check(
      "petty_cash_head_out_only",
      sql`(${t.direction} = 'Out' AND ${t.headId} IS NOT NULL)
          OR (${t.direction} = 'In' AND ${t.headId} IS NULL)`,
    ),

    /**
     * Zero is not a cash movement and a negative is a direction typed into the
     * wrong box. Both would quietly land in the balance.
     */
    check("petty_cash_amount_positive", sql`${t.amount} > 0`),

    /**
     * A blank purpose is a row nobody can account for a month later, which is
     * the only thing this table is for. NOT NULL does not catch a space.
     */
    check("petty_cash_purpose_not_blank", sql`length(btrim(${t.purpose})) > 0`),

    index("petty_cash_entry_date_idx").on(t.entryDate),
    index("petty_cash_head_idx").on(t.headId),
  ],
);
