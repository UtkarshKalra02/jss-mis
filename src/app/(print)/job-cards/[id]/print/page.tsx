import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { PrintBar } from "@/components/job-cards/print-button";
import { formatCommittedDate, formatDate, formatQty } from "@/lib/format";
import {
  designSelections,
  fabricationVocabulary,
  jobCardSelections,
  printedChecklist,
  type PrintedFabricationLine,
} from "@/modules/fabrication/queries";
import { getJobCard } from "@/modules/job-cards/queries";
import { gangInfoFor, getPressRun } from "@/modules/press-runs/queries";
import { resolvedSheet } from "@/modules/press-runs/sheet";
import { toolingForDesign } from "@/modules/tooling/queries";
import { locationLabel } from "@/modules/tooling/location";

export const metadata: Metadata = { title: "Job card · print" };

/**
 * THE PRINTED JOB CARD — one A4 sheet that replaces the paper form entirely.
 *
 * It prints and the challan does not, and that is not an inconsistency (J7):
 * print what is read by somebody who cannot open a screen. A challan is
 * handled at a desk with the system already open; a job card is read at a
 * press by people with no screen and no reason to have one.
 *
 * EXACTLY ONE THING ON THIS PAGE IS BLANK: final quantity, wastage and the run
 * remark, for the floor to write after the job runs and for somebody to
 * transcribe back afterwards (J4). Everything else is decided before the sheet
 * is printed and is therefore ON the sheet — the paper spec, the fabrication
 * checklist with its answers, the machine, the supply arrangements. A rule to
 * write on anywhere else would mean a fact living on paper only, which is the
 * thing this document exists to end.
 *
 * The band order follows the paper card so the floor recognises it: header and
 * check list, the job, supply and machine, paper detail, fabrication, job
 * execution, signatures.
 */
export default async function JobCardPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("job_card");

  const { id } = await params;
  const card = await getJobCard(id);
  if (!card) notFound();

  const [vocabulary, cardFab, tooling, gangs] = await Promise.all([
    fabricationVocabulary(),
    jobCardSelections(id),
    card.designId ? toolingForDesign(card.designId) : Promise.resolve([]),
    gangInfoFor([id]),
  ]);

  const designFab = card.designId ? await designSelections(card.designId) : new Map();
  const checklist = printedChecklist(vocabulary, designFab, cardFab);
  const gang = gangs.get(id);

  /*
   * THE RUN WINS (J15). A ganged card prints the sheet it is actually on, not
   * whatever its own columns happen to hold — two answers to "what am I
   * printing on" is the failure I7 removed design.die_id to avoid.
   */
  const run = card.pressRunId ? await getPressRun(card.pressRunId) : null;
  const sheet = resolvedSheet(
    card,
    run ? { ...run, machineName: run.machineName ?? run.machine } : null,
  );

  // The paper form runs its fabrication list in two columns. Split down the
  // middle so the sheet reads the way the one it replaces does.
  const half = Math.ceil(checklist.length / 2);
  const leftColumn = checklist.slice(0, half);
  const rightColumn = checklist.slice(half);

  return (
    <>
      <PrintBar backHref={`/job-cards/${card.id}`} backLabel={card.jcNo} />

      <article className="print-sheet">
        {/* ---------------------------------------------------------------- */}
        {/* Header — letterhead, title, number, check list                    */}
        {/* ---------------------------------------------------------------- */}
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
          <div className="flex items-start gap-3">
            {/* The real mark. Colour adjustment is forced in print.css, or the
                browser drops it to save ink. */}
            <Image src="/jss-logo.png" alt="" width={44} height={44} priority />
            <div>
              <h1 className="text-[15pt] leading-tight font-bold tracking-tight">
                JSS THE PRINT ZONE
              </h1>
              {/*
                Plot 39, with the rest of the estate address as given. The
                phone, email, website and ISO line on the reference card belong
                to another company and are deliberately NOT reproduced — that
                would put somebody else's contact details on JSS's document.
              */}
              <p className="text-[8pt] leading-snug">
                Plot No. 39, DSIDC, Scheme-1, Okhla Industrial Area, Phase-II,
                <br />
                New Delhi-110020 (India)
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[13pt] font-bold tracking-[0.06em] uppercase">Job Card</p>
            <p className="text-[13pt] font-bold tabular-nums">{card.jcNo}</p>
            <p className="text-[9pt]">Date: {formatDate(card.plannedDate ?? card.createdAt)}</p>
          </div>
        </header>

        {/* The paper card's top-left check list. Recorded, not enforced. */}
        <p className="mt-2 flex items-baseline gap-4 text-[10pt]">
          <span className="print-section-title">Check list</span>
          <Tick on={card.checklistPaper} label="Paper" />
          <Tick on={card.checklistPlates} label="Plates" />
          <Tick on={card.checklistColour} label="Colour" />
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* The job                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-2">
          <Row>
            <Cell label="Client" value={`${card.clientCode} — ${card.clientName}`} grow />
            <Cell label="Item code" value={card.itemCode} />
          </Row>
          <Row>
            <Cell label="Job name" value={card.itemName} grow />
            <Cell label="Design" value={card.designCode} />
          </Row>
          <Row last>
            <Cell
              label="Purchase order"
              value={
                card.clientPoNo
                  ? `${card.poInternalNo}  (client PO ${card.clientPoNo})`
                  : card.poInternalNo
              }
              grow
            />
            <Cell label="Committed" value={formatCommittedDate(card.committedDate)} />
            <Cell label="Ordered" value={formatQty(card.orderedQty)} />
            <Cell label="To run" value={formatQty(card.plannedQty)} strong />
          </Row>
        </section>

        {/* Ganging. On the sheet because the operator has to know the plate is
            shared before it goes on the press — H2 keeps the JOBS independent,
            which is exactly why the plate needs saying out loud. */}
        {gang ? (
          <p className="print-box mt-2 px-2 py-1 text-[10pt]">
            <span className="font-bold">GANGED</span> — printed on run{" "}
            <span className="font-bold tabular-nums">{gang.runNo}</span> (
            {formatDate(gang.runDate)})
            {gang.others > 0
              ? ` together with ${gang.others} other job${gang.others === 1 ? "" : "s"}. Do not treat the sheet as this job alone.`
              : "."}
            {" "}
            <span className="font-bold">
              The run sheet for {gang.runNo} is the document the press works from; this card
              covers only this client&rsquo;s job.
            </span>
          </p>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Supply and machine — the card's PROCESS HOUSE band                */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-2 px-2 py-1.5">
          <div className="grid grid-cols-3 gap-x-4">
            <SupplyBy label="Paper supply by" value={sheet.paperSupplyBy} />
            <SupplyBy label="Plate supply by" value={sheet.plateSupplyBy} />
            <div>
              <p className="print-label">Plate / job ID</p>
              <p className="print-value mt-0.5">{sheet.plateJobId ?? "—"}</p>
            </div>
          </div>

          <p className="mt-2 flex items-baseline gap-2 border-t border-neutral-400 pt-1.5">
            <span className="print-section-title">Machine</span>
            <span className="print-value">
              {sheet.machineName ?? "—"}
              {sheet.machineSheetSize ? ` · ${sheet.machineSheetSize}` : ""}
            </span>
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Paper detail — the PARENT SHEET, not the finished size            */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-2 px-2 py-1.5">
          <h2 className="print-section-title mb-1.5">
            Paper detail{sheet.fromRun ? ` — from run ${sheet.runNo}` : ""}
          </h2>
          <div className="grid grid-cols-5 gap-x-4">
            <Slot label="Size" value={sheet.paperSize} />
            <Slot label="GSM" value={sheet.paperGsm} />
            <Slot label="Matt / gloss" value={sheet.paperFinish} />
            <Slot label="Sheets / ream" value={formatQty(sheet.sheetsPerReam)} />
            <Slot label="Remarks" value={sheet.paperRemarks} />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Fabrication — every line, carrying its ANSWER                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-2 px-2 py-1.5">
          <h2 className="print-section-title mb-1.5">Fabrication detail</h2>

          {/* Every option prints, applying or not: the shape of the list is
              part of what the floor reads. What has changed from the paper form
              is that a ticked line carries its answer — "Foiling ✓ — Gold" —
              where the paper card carried a ruled blank (J8). */}
          <div className="grid grid-cols-2 gap-x-6">
            <ul className="space-y-1">
              {leftColumn.map((line) => (
                <FabricationRow key={line.optionId} line={line} />
              ))}
            </ul>
            <ul className="space-y-1">
              {rightColumn.map((line) => (
                <FabricationRow key={line.optionId} line={line} />
              ))}
            </ul>
          </div>

          {card.fabricationRemarks ? (
            <p className="mt-2 border-t border-neutral-400 pt-1.5 text-[10pt]">
              <span className="print-label">Remarks:</span> {card.fabricationRemarks}
            </p>
          ) : null}

          {tooling.length > 0 ? (
            <div className="mt-2 border-t border-neutral-400 pt-1.5">
              <p className="print-label">Job kitting — plates, dies &amp; blocks</p>
              <ul className="mt-1 space-y-0.5 text-[10pt]">
                {tooling.map((t) => (
                  <li key={t.id}>
                    <span className="font-bold tabular-nums">{t.toolNo}</span> · {t.name} ·{" "}
                    {/* Where it is kept: the one thing somebody sent to fetch a
                        die actually needs off this sheet (I8). */}
                    <span className="font-bold">{locationLabel(t)}</span>
                    {t.condition !== "Good" ? ` · ${t.condition}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Job execution — three cells blank, everything else printed        */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-2">
          <h2 className="print-section-title px-2 pt-1.5">Job execution</h2>

          <div className="mt-1 flex border-t border-neutral-400">
            <Cell label="No. of col." value={card.execNoOfColours} />
            <Cell label="Size" value={card.execSize} />
            <Cell label="Planning" value={card.execPlanning} grow />
          </div>

          {/* THE ONLY BLANK SECTION ON THE PAGE. These three do not exist when
              the sheet goes out, so they are written by hand at the press and
              typed back into the system afterwards (J4). */}
          <div className="flex border-t border-neutral-400">
            <BlankCell label="Final qty." />
            <BlankCell label="Wastage" />
            <BlankCell label="Remarks" grow />
          </div>
        </section>

        <footer className="print-avoid-break mt-3 grid grid-cols-3 gap-x-8">
          {["Operator", "Supervisor", "Checked by"].map((role) => (
            <div key={role}>
              <div className="print-hairline mt-7" />
              <p className="print-label mt-1">{role}</p>
            </div>
          ))}
        </footer>

        <p className="mt-3 text-[8pt] text-neutral-600">
          {card.jcNo} · printed from JSS MIS. Final quantity, wastage and remarks are written
          on this sheet by hand and typed back into the system afterwards. Everything else
          here is already recorded.
        </p>
      </article>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sheet primitives                                                            */
/* -------------------------------------------------------------------------- */

/** One fabrication line: a box, the process, and what was decided about it. */
function FabricationRow({ line }: { line: PrintedFabricationLine }) {
  return (
    <li className="flex items-baseline gap-1.5 text-[10.5pt]">
      <span className="print-check">{line.applies ? "✓" : ""}</span>
      <span className={line.applies ? "font-bold" : "text-neutral-600"}>{line.label}</span>
      {line.detail ? <span>— {line.detail}</span> : null}
      {/* An answer nobody has given. NOT a rule to write on — the card screen
          warns about this before the sheet is printed (J8). */}
      {line.awaitingValue ? <span className="text-neutral-600">— not recorded</span> : null}
    </li>
  );
}

function Tick({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="print-check">{on ? "✓" : ""}</span> {label}
    </span>
  );
}

function Row({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return <div className={`flex ${last ? "" : "border-b border-neutral-400"}`}>{children}</div>;
}

function Cell({
  label,
  value,
  grow,
  strong,
}: {
  label: string;
  value: string | null;
  grow?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`min-w-0 border-r border-neutral-400 px-2 py-1 last:border-r-0 ${grow ? "flex-1" : ""}`}
    >
      <p className="print-label">{label}</p>
      <p className={`print-value ${strong ? "font-bold" : ""}`}>
        {value && value.trim() !== "" ? value : "—"}
      </p>
    </div>
  );
}

/**
 * A cell that is empty ON PURPOSE.
 *
 * The three run figures, and nothing else on the sheet. Given real height so
 * there is somewhere to write — the difference between a blank the floor fills
 * and a blank that reads as missing data.
 */
function BlankCell({ label, grow }: { label: string; grow?: boolean }) {
  return (
    <div
      className={`min-w-0 border-r border-neutral-400 px-2 py-1 last:border-r-0 ${grow ? "flex-1" : ""}`}
    >
      <p className="print-label">{label}</p>
      {/* Real writing room. A 7mm gap is a label with nothing under it; this
          is a box somebody can put a figure in with a pen. */}
      <div className="h-10" />
    </div>
  );
}

/** A recorded field. Prints its value, or an em dash where nothing was given. */
function Slot({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="print-label">{label}</p>
      <p className="print-value mt-0.5">{value && value.trim() !== "" ? value : "—"}</p>
    </div>
  );
}

/** Press / Party, as two tick boxes, with the recorded answer marked. */
function SupplyBy({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="text-[10.5pt]">
      <p className="print-label">{label}</p>
      <p className="mt-0.5">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="print-check">{value === "Press" ? "✓" : ""}</span> Press
        </span>
        <span className="ml-4 inline-flex items-baseline gap-1.5">
          <span className="print-check">{value === "Party" ? "✓" : ""}</span> Party
        </span>
      </p>
    </div>
  );
}
