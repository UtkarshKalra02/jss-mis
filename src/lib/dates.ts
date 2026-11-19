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

/**
 * A `datetime-local` value, read as IST wall-clock time (W, migration 0047).
 *
 * The browser hands back "2026-11-17T10:05" with no zone on it. Passing that
 * to `new Date()` resolves it against whatever clock the SERVER is on, and the
 * server is Vercel, which is on UTC — so a confirmation typed as 10:05 in
 * Okhla would be stored as 10:05Z and read back as 15:35 IST. Five and a half
 * hours is more than twice the two-hour target the number is measured against,
 * so every item would look opened late.
 *
 * Same fix as startOfDayIST: say the offset out loud rather than inheriting
 * one. Seconds are optional because the input may or may not supply them.
 */
export function wallClockIST(value: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(value);
  if (!m) {
    throw new Error(`Expected a "YYYY-MM-DDTHH:MM" local time, got "${value}".`);
  }
  return new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}+05:30`);
}

/** Now as 'YYYY-MM-DDTHH:MM' in IST — the default for a datetime-local input. */
export function nowISTLocalInput(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // en-CA renders midnight as hour 24; the input needs 00.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
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

/**
 * A calendar date plus or minus some days, as 'YYYY-MM-DD'.
 *
 * Pure calendar arithmetic in UTC on purpose: the input is already a date
 * with no timezone, and pushing it through the local clock would shift it by
 * a day for anybody west of IST at midnight. This is how "tomorrow" is made
 * for the planning board (L1): `addDaysISO(todayIST(), 1)`.
 */
export function addDaysISO(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Expected a 'YYYY-MM-DD' date, got "${isoDate}".`);
  }
  const [y, m, d] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y!, m! - 1, d! + days));
  return shifted.toISOString().slice(0, 10);
}
