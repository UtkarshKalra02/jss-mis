import type { PlanEntryRow } from "./queries";

/**
 * One day's plan arranged by station — the right panel of the board and the
 * printed floor plan, from one function so the two cannot disagree (M2).
 *
 * THE STATION IS WHAT THE MEETING CHOSE. Each Production entry carries the
 * stage the job goes to that day (and the press, when one was picked). The
 * stage table is the factory's own vocabulary, ADMIN edits it, and its names,
 * colours and Hindi come from the database and nowhere else (non-negotiable
 * 5). The Dispatch entries form their own block at the end.
 *
 * Rows arrive sorted by kind, stage sequence, then the meeting's own order,
 * so grouping is one pass and the order inside a station is the queue.
 */

export type Station = {
  /** The stage code, or "DISPATCH" for the day's dispatch list. */
  key: string;
  kind: "Production" | "Dispatch";
  name: string | null;
  colour: string | null;
  rows: PlanEntryRow[];
  pendingQty: number;
};

export const DISPATCH_KEY = "DISPATCH";

export function groupByStation(rows: readonly PlanEntryRow[]): Station[] {
  const stations: Station[] = [];
  const byKey = new Map<string, Station>();

  for (const row of rows) {
    const key = row.kind === "Dispatch" ? DISPATCH_KEY : (row.stageCode ?? "");
    let station = byKey.get(key);
    if (!station) {
      station = {
        key,
        kind: row.kind,
        name: row.kind === "Dispatch" ? null : row.stageName,
        colour: row.kind === "Dispatch" ? null : row.stageColour,
        rows: [],
        pendingQty: 0,
      };
      byKey.set(key, station);
      stations.push(station);
    }
    station.rows.push(row);
    station.pendingQty += row.kind === "Dispatch" ? (row.plannedQty ?? 0) : row.pendingQty;
  }

  // Production first in stage order (already sorted), dispatch last.
  return [
    ...stations.filter((s) => s.kind === "Production"),
    ...stations.filter((s) => s.kind === "Dispatch"),
  ];
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
  dispatch: { en: "Dispatch", hi: "डिस्पैच" },
  position: { en: "#", hi: "क्रम" },
  stage: { en: "Stage now", hi: "अभी चरण" },
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
