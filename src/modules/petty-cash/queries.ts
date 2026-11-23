import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import { appUser, pettyCash, pettyCashHead } from "@/db/schema";
import { vPettyCashDay, vPettyCashHeadMonth } from "@/db/views";

/**
 * Reads for the petty cash tin.
 *
 * EVERY BALANCE COMES FROM `petty_cash_balance_on()`. Not one of these
 * functions adds up amounts itself, and that is the only rule in this file
 * worth defending: the sheet needs an opening and a closing figure, the history
 * needs one per day, and a month view needs one at each end. Written out three
 * times those are three chances to disagree about what is in the tin, and the
 * moment two definitions exist one of them is wrong — the same argument
 * non-negotiable 2 makes about pending_qty. The function is defined once, in
 * migration 0052.
 *
 * VOIDED ENTRIES are excluded everywhere except `voidedOn`, which exists to
 * show them. The function and both views already filter `deleted_at IS NULL`.
 */

export type PettyCashHeadRow = {
  id: string;
  code: string;
  name: string;
  sequence: number;
};

/** The heads a form may offer: active ones, in their configured order. */
export async function activeHeads(): Promise<PettyCashHeadRow[]> {
  return db
    .select({
      id: pettyCashHead.id,
      code: pettyCashHead.code,
      name: pettyCashHead.name,
      sequence: pettyCashHead.sequence,
    })
    .from(pettyCashHead)
    .where(isNull(pettyCashHead.deletedAt))
    .orderBy(asc(pettyCashHead.sequence), asc(pettyCashHead.name));
}

export type EntryRow = {
  id: string;
  entryDate: string;
  direction: "In" | "Out";
  amount: string;
  headId: string | null;
  headName: string | null;
  party: string | null;
  purpose: string;
  recordedByName: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  voidedByName: string | null;
};

/**
 * The entries on one day, oldest first.
 *
 * `live` are what the sheet totals; `voided` are shown beneath it, struck
 * through. Both are returned because a cash book that hides its corrections is
 * the thing a cash book exists not to be — and because "where did the 900 go"
 * is otherwise unanswerable without the audit log.
 */
export async function entriesOn(date: string): Promise<{ live: EntryRow[]; voided: EntryRow[] }> {
  /*
   * Two aliases onto app_user: who entered the row, and who voided it.
   *
   * `alias()` rather than a raw `sql` join, because drizzle has to know the
   * alias to build the ON clause and the select list from it. They are usually
   * the same person and occasionally the interesting difference.
   *
   * `voider` is joined only when the row is actually voided: updated_by carries
   * the last writer either way, so without that term a live row would name its
   * creator as the person who voided it.
   */
  const creator = alias(appUser, "creator");
  const voider = alias(appUser, "voider");

  const rows = await db
    .select({
      id: pettyCash.id,
      entryDate: pettyCash.entryDate,
      direction: pettyCash.direction,
      amount: pettyCash.amount,
      headId: pettyCash.headId,
      headName: pettyCashHead.name,
      party: pettyCash.party,
      purpose: pettyCash.purpose,
      recordedByName: creator.name,
      createdAt: pettyCash.createdAt,
      deletedAt: pettyCash.deletedAt,
      voidedByName: voider.name,
    })
    .from(pettyCash)
    .leftJoin(pettyCashHead, eq(pettyCashHead.id, pettyCash.headId))
    .leftJoin(creator, eq(creator.id, pettyCash.createdBy))
    .leftJoin(
      voider,
      sql`${voider.id} = ${pettyCash.updatedBy} and ${pettyCash.deletedAt} is not null`,
    )
    .where(eq(pettyCash.entryDate, date))
    .orderBy(asc(pettyCash.createdAt));

  return {
    live: rows.filter((r) => r.deletedAt === null),
    voided: rows.filter((r) => r.deletedAt !== null),
  };
}

export type DaySheet = {
  date: string;
  openingBalance: string;
  cashIn: string;
  cashOut: string;
  closingBalance: string;
  overdrawn: boolean;
  live: EntryRow[];
  voided: EntryRow[];
};

/**
 * One day's sheet, for any date — including a day with no movement.
 *
 * WHY NOT v_petty_cash_day. That view has a row only for days that had entries,
 * which is right for a history list and wrong here: a quiet Tuesday still has
 * an opening balance and still has to render. So the two figures come from
 * `petty_cash_balance_on()` directly — the SAME function the view uses, so the
 * quiet day and the busy day cannot report different balances.
 *
 * The day's own in and out totals are summed from the returned entries rather
 * than queried again. That is arithmetic over rows already in hand, not a
 * second definition of anything: whatever the sheet lists is what the sheet
 * adds up, which is the property somebody checking it with a calculator needs.
 */
export async function daySheet(date: string): Promise<DaySheet> {
  const [{ live, voided }, [balances]] = await Promise.all([
    entriesOn(date),
    db.execute<{ opening: string; closing: string }>(sql`
      select petty_cash_balance_on((${date}::date - 1))::text as opening,
             petty_cash_balance_on(${date}::date)::text       as closing
    `).then((r) => (r as unknown as { rows: { opening: string; closing: string }[] }).rows),
  ]);

  const total = (direction: "In" | "Out") =>
    live
      .filter((e) => e.direction === direction)
      .reduce((sum, e) => sum + Number(e.amount), 0)
      .toFixed(2);

  return {
    date,
    openingBalance: balances?.opening ?? "0.00",
    cashIn: total("In"),
    cashOut: total("Out"),
    closingBalance: balances?.closing ?? "0.00",
    overdrawn: Number(balances?.closing ?? 0) < 0,
    live,
    voided,
  };
}

export type HeadMonthRow = typeof vPettyCashHeadMonth.$inferSelect;

/**
 * Where a month went, by head. Biggest first — the question being asked is
 * "what is eating the cash", and sequence order answers a different one.
 */
export async function monthByHead(monthStart: string): Promise<HeadMonthRow[]> {
  return db
    .select()
    .from(vPettyCashHeadMonth)
    .where(eq(vPettyCashHeadMonth.month, monthStart))
    .orderBy(desc(vPettyCashHeadMonth.spent));
}

export type MonthTopUpRow = {
  id: string;
  entryDate: string;
  amount: string;
  party: string | null;
  purpose: string;
};

/**
 * The top-ups in a month: every `In` entry, oldest first.
 *
 * WHY A LIST AND NOT A TOTAL. The by-head table answers "what is eating the
 * cash"; this answers "where did the cash come from", and for that the rows
 * matter more than the figure. A month holds a handful of top-ups — Amit Sir
 * handing over 5,000, twice — and each one is a specific handover somebody may
 * need to confirm. A single number cannot be checked against anything; four
 * dated rows can.
 *
 * It also fills the hole this screen had until 23 Nov 2026: an `In` entry showed
 * on its own day's sheet and then vanished, because the month block reads
 * v_petty_cash_head_month, which is Out-only by construction — a top-up has no
 * head to group by. So the month's arithmetic showed money leaving a tin that
 * nothing had ever gone into.
 *
 * The total is summed from these rows by the page, not queried again: the same
 * property `daySheet` keeps, so what is listed is what is added up.
 *
 * Takes a runner, like `listClientsForMatching` does, so the test can call this
 * function itself inside a rolled-back transaction rather than a copy of its
 * WHERE clause — the month boundary being the part worth actually testing.
 */
export async function monthTopUps(
  monthStart: string,
  runner: typeof db | Tx = db,
): Promise<MonthTopUpRow[]> {
  return runner
    .select({
      id: pettyCash.id,
      entryDate: pettyCash.entryDate,
      amount: pettyCash.amount,
      party: pettyCash.party,
      purpose: pettyCash.purpose,
    })
    .from(pettyCash)
    .where(
      and(
        isNull(pettyCash.deletedAt),
        eq(pettyCash.direction, "In"),
        gte(pettyCash.entryDate, monthStart),
        // Half-open on purpose: no month-length arithmetic to get wrong, and
        // February needs no special case.
        sql`${pettyCash.entryDate} < (${monthStart}::date + interval '1 month')`,
      ),
    )
    .orderBy(asc(pettyCash.entryDate), asc(pettyCash.createdAt));
}

export type DayRow = typeof vPettyCashDay.$inferSelect;

/** The last `limit` days that had movement, newest first. */
export async function recentDays(limit = 30): Promise<DayRow[]> {
  return db
    .select()
    .from(vPettyCashDay)
    .orderBy(desc(vPettyCashDay.entryDate))
    .limit(limit);
}

/** Does this entry exist, and is it currently voided? For the void/un-void actions. */
export async function entryState(id: string): Promise<{ exists: boolean; voided: boolean }> {
  const [row] = await db
    .select({ deletedAt: pettyCash.deletedAt })
    .from(pettyCash)
    .where(eq(pettyCash.id, id))
    .limit(1);
  if (!row) return { exists: false, voided: false };
  return { exists: true, voided: row.deletedAt !== null };
}
