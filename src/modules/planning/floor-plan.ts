import type { PlanningRow } from "./queries";

/**
 * One day's plan arranged by station — the right panel of the board and the
 * printed floor plan, from one function so the two cannot disagree (L2).
 *
 * THE STATION IS THE CARD'S CURRENT STAGE. There is no station table; the
 * stage table is the factory's own vocabulary for where work is, ADMIN edits
 * it, and its names, colours and Hindi come from the database and nowhere
 * else (non-negotiable 5). A card whose first item is at Lamination is
 * tomorrow's lamination work. Nothing is stored for this, so nothing can go
 * stale — the cost, accepted knowingly, is that a card planned from a
 * pre-production stage (Approved, Material Ready) is listed under that stage
 * with its machine on the row, rather than under the press it will go to. A
 * chosen "planned station" per card is the upgrade if the meeting finds that
 * wrong; it is a column and a select, not a redesign.
 *
 * Rows arrive sorted by stage sequence, then urgency, so grouping is one pass.
 */

export type Station = {
  /** The stage code, or null for cards whose item has no stage event yet. */
  key: string | null;
  name: string | null;
  colour: string | null;
  rows: PlanningRow[];
  pendingQty: number;
};

export function groupByStation(rows: readonly PlanningRow[]): Station[] {
  const stations: Station[] = [];
  const byKey = new Map<string | null, Station>();

  for (const row of rows) {
    const key = row.currentStage;
    let station = byKey.get(key);
    if (!station) {
      station = {
        key,
        name: row.currentStageName,
        colour: row.currentStageColour,
        rows: [],
        pendingQty: 0,
      };
      byKey.set(key, station);
      stations.push(station);
    }
    station.rows.push(row);
    station.pendingQty += row.pendingQty;
  }

  // Cards with no stage yet go last, whatever order they arrived in. "Not
  // started" is a real state (F19 makes it rare), not the first station.
  return [...stations.filter((s) => s.key !== null), ...stations.filter((s) => s.key === null)];
}

/* -------------------------------------------------------------------------- */
/* The two languages of the printed sheet                                      */
/* -------------------------------------------------------------------------- */

export type Lang = "en" | "hi";

/**
 * The FIXED words on the floor plan. Job names, client codes and card numbers
 * print as typed in whichever language they were typed; stage names come from
 * the stage table's own `name_hi` (L3) and fall back to English when blank.
 * This dictionary is only the furniture — headings and column labels — which
 * is the part a component may legitimately own.
 */
const STRINGS = {
  title: { en: "Daily Floor Plan", hi: "दैनिक फ्लोर प्लान" },
  internal: { en: "Internal — not for issue to a customer", hi: "आंतरिक — ग्राहक को नहीं देना है" },
  planFor: { en: "Plan for", hi: "योजना दिनांक" },
  printed: { en: "Printed", hi: "छपा" },
  jobs: { en: "jobs", hi: "काम" },
  job: { en: "job", hi: "काम" },
  pieces: { en: "pcs", hi: "नग" },
  card: { en: "Card", hi: "कार्ड" },
  jobName: { en: "Job", hi: "काम" },
  client: { en: "Client", hi: "ग्राहक" },
  machine: { en: "Machine", hi: "मशीन" },
  qty: { en: "Qty", hi: "मात्रा" },
  due: { en: "Due", hi: "डिलीवरी" },
  overdue: { en: "overdue", hi: "देरी" },
  today: { en: "today", hi: "आज" },
  daysLeft: { en: "days left", hi: "दिन बाकी" },
  noCommitment: { en: "no date", hi: "तारीख नहीं" },
  notStarted: { en: "Not started", hi: "शुरू नहीं" },
  mixed: { en: "several stages", hi: "कई चरण" },
  more: { en: "more", hi: "और" },
  nothing: { en: "Nothing planned for this day.", hi: "इस दिन के लिए कुछ योजना नहीं है।" },
  footer: {
    en: "Printed from JSS MIS. Stages and quantities are live at the time of printing.",
    hi: "JSS MIS से छपा। चरण और मात्रा छपाई के समय की हैं।",
  },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang];
}

/**
 * A stage's name for the sheet: the Hindi where somebody has typed it, the
 * English otherwise. Blank Hindi is the seeded state (L3) and must read as
 * "English on a Hindi sheet", never as a gap.
 */
export function stageLabel(
  stage: { name: string; nameHi: string | null } | undefined,
  fallback: string | null,
  lang: Lang,
): string {
  if (!stage) return fallback ?? "";
  if (lang === "hi" && stage.nameHi && stage.nameHi.trim() !== "") return stage.nameHi;
  return stage.name;
}

/** "3 days left" / "2 days overdue" / "today", in either language. */
export function dueWords(days: number | null, lang: Lang): string {
  if (days === null || !Number.isFinite(days)) return t("noCommitment", lang);
  if (days === 0) return t("today", lang);
  if (days > 0) return lang === "hi" ? `${days} ${t("daysLeft", lang)}` : `${days} day${days === 1 ? "" : "s"} left`;
  const late = Math.abs(days);
  return lang === "hi" ? `${late} दिन ${t("overdue", lang)}` : `${late} day${late === 1 ? "" : "s"} overdue`;
}
