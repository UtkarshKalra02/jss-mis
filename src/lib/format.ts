/**
 * Display formatting.
 *
 * Two rules from section 7 are enforced here rather than left to call sites:
 * money uses INDIAN grouping (lakh/crore — ₹12,34,560, not ₹1,234,560), and
 * dates are rendered in Asia/Kolkata. Both are easy to get subtly wrong in a
 * way nobody notices until a number looks unfamiliar to the person reading it.
 */

export const IST = "Asia/Kolkata";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const inrPreciseFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-IN");

/**
 * ₹12,34,560 — lakh/crore grouping, no paise.
 *
 * FOR TOTALS AND LIMITS, never for a per-unit rate. Rounding half a rupee off
 * an order value of ₹13,499.50 is invisible; rounding it off a rate of ₹4.50
 * prints ₹5, which is an 11% misstatement of the number somebody is checking
 * against a purchase order. Use `formatINRPrecise` for anything per-unit.
 */
export function formatINR(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return inrFormatter.format(n);
}

/**
 * ₹12,34,560.75 — for ledgers, invoices, and every PER-UNIT RATE.
 *
 * Rates are `numeric(14,2)` and the forms accept `step="0.01"`, so the paise
 * are real and stored. They were being rounded away only at the point of
 * display, which made ₹4.50 read as ₹5 on the purchase order screen.
 */
export function formatINRPrecise(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return inrPreciseFormatter.format(n);
}

/** 12,34,560 — quantities, counts. */
export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return numberFormatter.format(n);
}

/** 87.5% */
export function formatPercent(
  value: number | string | null | undefined,
  digits = 1,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/**
 * 17 Aug 2026, in IST.
 *
 * Accepts a Date or the plain 'YYYY-MM-DD' string Postgres date columns come
 * back as. Those are already calendar dates with no timezone, so they are
 * parsed as such — running them through the timezone conversion would shift
 * them by a day for anyone west of IST.
 */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y!, m! - 1, d!)));
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: IST,
  }).format(date);
}

/** 17 Aug 2026, 8:15 pm — for stage events, where the time is the point. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(date);
}

/** "3 days left", "today", "2 days overdue" — from v_po_item_status. */
export function formatDaysToCommitted(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "—";
  if (days === 0) return "today";
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} left`;
  const late = Math.abs(days);
  return `${late} day${late === 1 ? "" : "s"} overdue`;
}

/**
 * How a missing committed date reads on screen (decision F8, point 5).
 *
 * A blank cell says "somebody should go and fill this in". The whole point of
 * a null commitment is that there is nothing to fill in — the job came out of
 * a paper book and no date was ever recorded. Saying so explicitly is what
 * stops the gap looking like an error, and stops anyone "helpfully" inventing
 * a date that would then feed OTD.
 *
 * Exported as a constant as well so screens can match on it for styling
 * without retyping the sentence.
 */
export const NO_COMMITMENT = "Historical \u2014 no commitment recorded";

export function formatCommittedDate(value: Date | string | null | undefined): string {
  if (!value) return NO_COMMITMENT;
  return formatDate(value);
}
