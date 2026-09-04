import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { PrintBar } from "@/components/job-cards/print-button";
import { formatDate, formatQty } from "@/lib/format";
import {
  designSelections,
  fabricationVocabulary,
  jobCardSelections,
  printedChecklist,
  type PrintedFabricationLine,
} from "@/modules/fabrication/queries";
import { paperCount, paperQuantityLine } from "@/modules/job-cards/paper";
import { getPressRun, getRunMembers } from "@/modules/press-runs/queries";

export const metadata: Metadata = { title: "Press run · print" };

/**
 * THE PRESS RUN SHEET — one document for what is physically one print run.
 *
 * Punit regularly combines small jobs from different clients onto one sheet:
 * three hotel-amenity soap wrappers that would each waste most of a plate
 * alone. Until now that produced two or three job cards for one trip through
 * the press, and the floor had to work out for itself that they were the same
 * sheet.
 *
 * NOTHING ABOUT OWNERSHIP CHANGES. Each client's design is approved and
 * tracked separately, each item keeps its own job card, its own committed date
 * and its own OTD — H1 through H7 stand exactly as built. This is one printed
 * document over the top of them, not a merge.
 *
 * THE SHAPE FOLLOWS WHAT IS ACTUALLY SHARED AND WHAT IS NOT:
 *
 *   Shared, printed once — the sheet. One paper detail block, one plate and
 *   supply arrangement, one machine. A ganged run has one of each by
 *   definition, and printing them per job would invite two answers.
 *
 *   Per job — client, item, quantity, and its OWN fabrication checklist with
 *   its own captured detail. Two clients on one sheet still need different
 *   finishing after printing: one goes to lamination, another straight to
 *   die-cut. H2 refused to make ganged cards share a stage for exactly this
 *   reason, and the sheet has to show it.
 *
 *   Blank — ONE set of final quantity, wastage and remarks for the plate, plus
 *   ruled space for a per-client split if the count needs dividing after the
 *   fact. Same rule as the job card (J4): the only thing left empty is what
 *   does not exist when the sheet goes out.
 *
 * A run with one member still prints, and reads as a perfectly ordinary sheet.
 * This is additive — individual job card printing is unchanged (J15).
 */
export default async function PressRunPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("press_run");

  const { id } = await params;
  const run = await getPressRun(id);
  if (!run) notFound();

  const [members, vocabulary] = await Promise.all([
    getRunMembers(id),
    fabricationVocabulary(),
  ]);

  // Derived here, never stored (J18).
  const paper = paperCount({ qty: run.paperQty, bundle: run.paperBundle, parts: run.paperParts });

  /*
   * One checklist per job on the plate. Design-scope answers come from that
   * member's design, run-scope answers from its own card — so "new die" is
   * answered per job even though the sheet is shared (J8).
   */
  const checklists = await Promise.all(
    members.map(async (m) => ({
      member: m,
      lines: printedChecklist(
        vocabulary,
        m.designId ? await designSelections(m.designId) : new Map(),
        await jobCardSelections(m.jobCardId),
      ).filter((l) => l.applies),
    })),
  );

  const clients = new Set(members.map((m) => m.clientCode));
  const machineLabel =
    run.machineName ?? run.machine ?? null;

  return (
    <>
      <PrintBar backHref={`/press-runs/${run.id}`} backLabel={run.runNo} />

      <article className="print-sheet">
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
          <div className="flex items-start gap-3">
            <Image src="/jss-logo.png" alt="" width={44} height={44} priority />
            <div>
              <h1 className="text-[15pt] leading-tight font-bold tracking-tight">
                JSS THE PRINT ZONE
              </h1>
              <p className="text-[8pt] leading-snug">
                Plot No. 39, DSIDC, Scheme-1, Okhla Industrial Area, Phase-II,
                <br />
                New Delhi-110020 (India)
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[13pt] font-bold tracking-[0.06em] uppercase">Press Run</p>
            <p className="text-[13pt] font-bold tabular-nums">{run.runNo}</p>
            <p className="text-[9pt]">Date: {formatDate(run.runDate)}</p>
          </div>
        </header>

        {/* Says out loud what this sheet is, because an operator picking it up
            must not treat it as one job. H3: several clients on one plate is
            correct here and is never flagged as a problem. */}
        <p className="print-box mt-2 px-2 py-1.5 text-[10.5pt]">
          <span className="font-bold">ONE SHEET, {members.length} JOB
          {members.length === 1 ? "" : "S"}</span>
          {clients.size > 1
            ? ` for ${clients.size} clients. Each job keeps its own quantity and its own finishing — check every block below before the sheet leaves the press.`
            : ". Printed as a run rather than a single job card."}
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* Shared: the sheet                                                 */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-2 px-2 py-1.5">
          <h2 className="print-section-title mb-1.5">The sheet — shared by every job</h2>

          <div className="grid grid-cols-5 gap-x-4">
            <Slot label="Size" value={run.paperSize} />
            <Slot label="GSM" value={run.paperGsm} />
            <Slot label="Matt / gloss" value={run.paperFinish} />
            <Slot label="Quantity" value={paperQuantityLine(run)} />
            <Slot label="Remarks" value={run.paperRemarks} />
          </div>

          {/* One plate, one paper figure — every card on it shares these (J15, J18). */}
          <div className="mt-1.5 grid grid-cols-5 gap-x-4 border-t border-neutral-400 pt-1.5">
            <Slot label="Parent sheets" value={formatQty(paper.parentSheets)} />
            <Slot label="Parts" value={run.paperParts ? String(run.paperParts) : "1 (uncut)"} />
            <Slot label="Press sheets" value={formatQty(paper.pressSheets)} />
          </div>

          <div className="mt-2 grid grid-cols-3 gap-x-4 border-t border-neutral-400 pt-1.5">
            <SupplyBy label="Paper supply by" value={run.paperSupplyBy} />
            <SupplyBy label="Plate supply by" value={run.plateSupplyBy} />
            <Slot label="Plate / job ID" value={run.plateJobId} />
          </div>

          <p className="mt-2 flex items-baseline gap-2 border-t border-neutral-400 pt-1.5">
            <span className="print-section-title">Machine</span>
            <span className="print-value">
              {machineLabel ?? "—"}
              {run.machineSheetSize ? ` · ${run.machineSheetSize}` : ""}
            </span>
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Per job on the plate                                              */}
        {/* ---------------------------------------------------------------- */}
        {checklists.map(({ member, lines }, i) => (
          <section
            key={member.jobCardId}
            className="print-avoid-break print-box mt-2 px-2 py-1.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-neutral-400 pb-1">
              <span className="text-[11pt] font-bold">
                {i + 1}. {member.clientCode} — {member.clientName}
              </span>
              <span className="text-[9pt] tabular-nums">
                {member.jcNo}
                {member.designCode ? ` · ${member.designCode}` : ""}
              </span>
            </div>

            <div className="mt-1.5 grid grid-cols-4 gap-x-4">
              <div className="col-span-2">
                <p className="print-label">Item</p>
                <p className="print-value">{member.itemName}</p>
              </div>
              <Slot label="Item code" value={member.itemCode} />
              <div>
                <p className="print-label">Quantity to run</p>
                <p className="print-value font-bold">{formatQty(member.plannedQty)}</p>
              </div>
            </div>

            {/* This job's OWN finishing. Two clients on one sheet legitimately
                diverge the moment it comes off the press (H2). */}
            <div className="mt-1.5 border-t border-neutral-400 pt-1.5">
              <p className="print-label">Fabrication for this job</p>
              {lines.length === 0 ? (
                <p className="text-[10pt]">Nothing beyond printing.</p>
              ) : (
                <ul className="mt-0.5 flex flex-wrap gap-x-5 gap-y-0.5">
                  {lines.map((line) => (
                    <FabricationItem key={line.optionId} line={line} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}

        {/* ---------------------------------------------------------------- */}
        {/* Blank — the only thing on the page that is                        */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-2">
          <h2 className="print-section-title px-2 pt-1.5">
            After the run — fill in by hand
          </h2>

          <div className="mt-1 flex border-t border-neutral-400">
            <BlankCell label="Final qty. (whole sheet)" />
            <BlankCell label="Wastage" />
            <BlankCell label="Remarks" grow />
          </div>

          {/* The split only matters sometimes, so it is space rather than a
              form. Whoever needs it writes it here and types it into the run's
              remarks afterwards (J15). */}
          <div className="border-t border-neutral-400 px-2 py-1.5">
            <p className="print-label">
              Split per client, if the count needs dividing
            </p>
            {members.map((m) => (
              <p key={m.jobCardId} className="mt-2 flex items-baseline gap-2 text-[10pt]">
                <span className="w-40 shrink-0">
                  {m.clientCode} · {m.itemCode}
                </span>
                <span className="print-hairline mt-3 flex-1" />
              </p>
            ))}
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
          {run.runNo} · printed from JSS MIS. Each job on this sheet is tracked separately —
          its own client, its own committed date, its own delivery. Only the sheet is shared.
        </p>
      </article>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sheet primitives                                                            */
/* -------------------------------------------------------------------------- */

function FabricationItem({ line }: { line: PrintedFabricationLine }) {
  return (
    <li className="flex items-baseline gap-1.5 text-[10pt]">
      <span className="print-check">✓</span>
      <span className="font-bold">{line.label}</span>
      {line.detail ? <span>— {line.detail}</span> : null}
      {line.awaitingValue ? <span className="text-neutral-600">— not recorded</span> : null}
    </li>
  );
}

function Slot({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="print-label">{label}</p>
      <p className="print-value mt-0.5">{value && value.trim() !== "" ? value : "—"}</p>
    </div>
  );
}

/** Empty on purpose — the one band the floor writes on. */
function BlankCell({ label, grow }: { label: string; grow?: boolean }) {
  return (
    <div
      className={`min-w-0 border-r border-neutral-400 px-2 py-1 last:border-r-0 ${grow ? "flex-1" : ""}`}
    >
      <p className="print-label">{label}</p>
      <div className="h-10" />
    </div>
  );
}

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
