import type { Metadata } from "next";
import Image from "next/image";

import { requireAccess } from "@/auth/guard";
import { FloorPlanBar } from "@/components/planning/floor-plan-bar";
import { addDaysISO, todayIST } from "@/lib/dates";
import { formatDate, formatQty } from "@/lib/format";
import {
  dueWords,
  groupByStation,
  stageLabel,
  t,
  type Lang,
  type Station,
} from "@/modules/planning/floor-plan";
import { dayPlan } from "@/modules/planning/queries";
import { listStages, type StageRow } from "@/modules/stages/queries";

export const metadata: Metadata = { title: "Floor plan · print" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * THE DAILY FLOOR PLAN — spec 6.6's print action, the fourth print surface
 * after the job card (J7), the challan (K14) and the pending work sheet (K16).
 *
 * "Jobs grouped by station, bold job names, minimal." One day's plan from
 * `dayPlan`, arranged by `groupByStation` — the same query and the same
 * function as the board's right panel, so the paper cannot disagree with the
 * screen it was printed from. Production by station in the meeting's order,
 * then the dispatch list (M2, M3).
 *
 * ENGLISH OR HINDI, from `?lang=`. Stage names come from the stage table's
 * own `name_hi` where somebody has typed it and fall back to English where
 * not (L3); job names, clients and card numbers print as typed. The only
 * words this page owns are the headings.
 *
 * INTERNAL. Several clients' jobs on one page — never handed to a customer.
 */
export default async function FloorPlanPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; lang?: string }>;
}) {
  await requireAccess("job_planning");

  const sp = await searchParams;
  const date = sp.date && ISO_DATE.test(sp.date) ? sp.date : addDaysISO(todayIST(), 1);
  const lang: Lang = sp.lang === "hi" ? "hi" : "en";

  const [rows, stages] = await Promise.all([dayPlan(date), listStages()]);
  const byCode = new Map(stages.map((s) => [s.code, s]));
  const stations = groupByStation(rows);

  const production = rows.filter((r) => r.kind === "Production");
  const dispatch = rows.filter((r) => r.kind === "Dispatch");
  const dispatchQty = dispatch.reduce((n, r) => n + (r.plannedQty ?? 0), 0);

  return (
    <>
      <FloorPlanBar date={date} lang={lang} />

      <div className="print-sheet" lang={lang}>
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
          <div className="flex items-start gap-3">
            <Image src="/jss-logo.png" alt="" width={44} height={44} priority />
            <div>
              <h1 className="text-[15pt] leading-tight font-bold tracking-tight">
                JSS THE PRINT ZONE
              </h1>
              <p className="print-label mt-0.5">{t("internal", lang)}</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[13pt] font-bold tracking-[0.06em] uppercase">{t("title", lang)}</p>
            <p className="print-label mt-1">{t("planFor", lang)}</p>
            <p className="text-[14pt] font-bold tabular-nums">{formatDate(date)}</p>
          </div>
        </header>

        <section className="print-avoid-break mt-2 border-b border-neutral-400 pb-2">
          <p className="print-hint">
            {production.length} {t(production.length === 1 ? "job" : "jobs", lang)}
            {dispatch.length > 0
              ? ` · ${t("dispatch", lang)} ${dispatch.length} · ${formatQty(dispatchQty)} ${t("pieces", lang)}`
              : ""}
            {" · "}
            {t("printed", lang)} {formatDate(todayIST())}
          </p>
        </section>

        {stations.length === 0 ? (
          <p className="mt-6 text-center text-[11pt]">{t("nothing", lang)}</p>
        ) : (
          <div className="mt-3 space-y-4">
            {stations.map((station) => (
              <StationBlock
                key={station.key}
                station={station}
                label={
                  station.kind === "Dispatch"
                    ? t("dispatch", lang)
                    : stageLabel(byCode.get(station.key), station.name, lang)
                }
                lang={lang}
                byCode={byCode}
              />
            ))}
          </div>
        )}

        <p className="print-hint mt-4 border-t border-neutral-400 pt-1">{t("footer", lang)}</p>
      </div>
    </>
  );
}

/**
 * One station. The heading is where the jobs go; the rows are the queue in
 * the meeting's order, names in bold because the operator reads the name
 * first and everything else second.
 *
 * NO COLOUR. print.css is black on white and a laser printer drops red to
 * save ink, so "overdue" is carried by the words in the Due column, set bold.
 */
function StationBlock({
  station,
  label,
  lang,
  byCode,
}: {
  station: Station;
  label: string;
  lang: Lang;
  byCode: Map<string, StageRow>;
}) {
  const isDispatch = station.kind === "Dispatch";

  return (
    <section className="print-avoid-break">
      <div className="flex items-baseline justify-between border-b border-black pb-0.5">
        <h2 className="text-[12pt] font-bold tracking-[0.04em] uppercase">{label}</h2>
        <p className="print-hint tabular-nums">
          {station.rows.length} {t(station.rows.length === 1 ? "job" : "jobs", lang)} ·{" "}
          {formatQty(station.pendingQty)} {t("pieces", lang)}
        </p>
      </div>

      <table className="w-full border-collapse text-[10pt]">
        <thead>
          <tr>
            <Th>{t("position", lang)}</Th>
            <Th>{t("jobName", lang)}</Th>
            <Th>{t("client", lang)}</Th>
            {isDispatch ? null : <Th>{t("card", lang)}</Th>}
            {isDispatch ? null : <Th>{t("machine", lang)}</Th>}
            <Th>{t("stage", lang)}</Th>
            <Th align="right">{t("qty", lang)}</Th>
            <Th>{t("due", lang)}</Th>
          </tr>
        </thead>
        <tbody>
          {station.rows.map((row, i) => (
            <tr key={row.entryId}>
              <Td className="tabular-nums">{i + 1}</Td>
              <Td>
                <span className="text-[11pt] font-bold">{row.itemName}</span>
                <span className="print-hint"> {row.itemCode}</span>
              </Td>
              <Td>{row.clientCode}</Td>
              {isDispatch ? null : <Td className="whitespace-nowrap tabular-nums">{row.jcNo ?? ""}</Td>}
              {isDispatch ? null : <Td>{row.machineName ?? ""}</Td>}
              {/* Where the job is tonight — so the floor knows where to fetch it from. */}
              <Td>
                {row.currentStage
                  ? stageLabel(byCode.get(row.currentStage), row.currentStageName, lang)
                  : t("notStarted", lang)}
              </Td>
              <Td className="text-right tabular-nums">
                {formatQty(isDispatch ? row.plannedQty : row.pendingQty)}
              </Td>
              <Td className="whitespace-nowrap">
                {row.committedDate ? (
                  <>
                    <span className="tabular-nums">{formatDate(row.committedDate)}</span>
                    <span className={row.isOverdue ? "font-bold" : ""}>
                      {" "}
                      · {dueWords(row.daysToCommitted, lang)}
                    </span>
                  </>
                ) : (
                  <span className="print-hint">{t("noCommitment", lang)}</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`border-b border-neutral-500 px-1 py-0.5 text-[8.5pt] font-bold ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`border-b border-neutral-300 px-1 py-1 align-top ${className ?? ""}`}>
      {children}
    </td>
  );
}
