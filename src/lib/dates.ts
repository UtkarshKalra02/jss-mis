import { IST } from "./format";

/**
 * Date helpers that cross the boundary between a calendar date and an instant.
 *
 * Decision C10: all date-boundary arithmetic casts to Asia/Kolkata. The views
 * do it in SQL with today_ist(); this is the TypeScript side of the same rule.
 * Getting it wrong is invisible — no error, just a stage event or a dispatch
 * recorded on the wrong day, which silently moves OTD.
 */

/**
 * A 'YYYY-MM-DD' calendar date, as the instant that day BEGAN in the factory's
 * timezone.
 *
 * Used when a business date has to be written into a timestamptz column — a
 * PO_RECEIVED event dated by the PO, a DISPATCHED event dated by the challan
 * (F3). The offset is written literally rather than computed because India has
 * no daylight saving and has been at +05:30 throughout; a library that
 * "handles" that would be more machinery than the problem.
 *
 * Note what this is NOT for: the moment something was typed. That is just
 * new Date(), and stage_event keeps it separately in created_at precisely
 * because the two are different and the gap is sometimes evidence.
 */
export function startOfDayIST(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Expected a 'YYYY-MM-DD' date, got "${isoDate}".`);
  }
  return new Date(`${isoDate}T00:00:00+05:30`);
}

/** Today as 'YYYY-MM-DD' in IST — the default for a date input. */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
