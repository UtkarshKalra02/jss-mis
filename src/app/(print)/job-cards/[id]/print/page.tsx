import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { PrintBar } from "@/components/job-cards/print-button";
import { formatCommittedDate, formatDate, formatQty } from "@/lib/format";
import { getJobCard, processChecklistFor } from "@/modules/job-cards/queries";
import { gangInfoFor } from "@/modules/press-runs/queries";
import { toolingForDesign } from "@/modules/tooling/queries";

export const metadata: Metadata = { title: "Job card · print" };

/**
 * THE PRINTED JOB CARD (decision J5).
 *
 * This one prints and the challan does not, and the difference is not an
 * inconsistency — see J7. A challan is handled by Preeti, who has the system
 * open in front of her. A job card is read by people standing at a press who
 * cannot open anything, which makes the sheet the only copy they have. So
 * every field the floor needs is on it, and anything the system does not know
 * is printed as a RULE TO WRITE ON rather than omitted: a missing line is a
 * question, where a blank line is an instruction.
 *
 * THREE BOXES PRINT BLANK EVEN WHEN THE SYSTEM HAS THE VALUES. Final quantity,
 * wastage and remarks are filled in by hand after the run and transcribed back
 * afterwards (J4). Printing a previously-recorded figure onto a fresh card
 * would be printing last run's number onto this run's sheet.
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

  const [processes, tooling, gangs] = await Promise.all([
    processChecklistFor(card.designId),
    card.designId ? toolingForDesign(card.designId) : Promise.resolve([]),
    gangInfoFor([id]),
  ]);

  const gang = gangs.get(id);

  return (
    <>
      <PrintBar backHref={`/job-cards/${card.id}`} backLabel={card.jcNo} />

      <article className="print-sheet">
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                            */}
        {/* ---------------------------------------------------------------- */}
        <header className="flex items-start justify-between border-b-2 border-black pb-2">
          <div>
            <h1 className="text-[15pt] leading-tight font-bold tracking-tight">
              JSS THE PRINT ZONE
            </h1>
            <p className="text-[8.5pt] tracking-[0.08em] uppercase">Offset printing &amp; packaging</p>
          </div>

          <div className="text-right">
            <p className="text-[13pt] font-bold tracking-[0.06em] uppercase">Job Card</p>
            <p className="text-[13pt] font-bold tabular-nums">{card.jcNo}</p>
            <p className="text-[9pt]">
              Date: {formatDate(card.plannedDate ?? card.createdAt)}
            </p>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        {/* The job                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break print-box mt-3">
          <Row>
            <Cell label="Client" value={`${card.clientCode} — ${card.clientName}`} grow />
            <Cell label="Job card no." value={card.jcNo} />
          </Row>
          <Row>
            <Cell label="Item" value={card.itemName} grow />
            <Cell label="Item code" value={card.itemCode} />
          </Row>
          <Row>
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
          </Row>
          <Row last>
            <Cell label="Quantity ordered" value={formatQty(card.orderedQty)} />
            <Cell label="Quantity to run" value={formatQty(card.plannedQty)} strong />
            <Cell label="Design" value={card.designCode ?? null} grow />
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
          </p>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Paper                                                             */}
        {/* ---------------------------------------------------------------- */}
        <Block title="Paper">
          <div className="grid grid-cols-3 gap-x-4 gap-y-2">
            <Slot label="Size" value={card.designJobSize} />
            <Slot label="GSM" value={card.designGsm} />
            <Slot label="Type / finish" value={card.designPaperType} />
            <Slot label="Printing" value={card.designPrintType} />
            <Slot label="Colours" value={card.designNoOfColours} />
            {/* No column holds this anywhere in the system, so it is always a
                rule. Better an honest blank than a field invented to fill a
                gap in a form. */}
            <Slot label="Sheets / ream" value={null} />
          </div>

          <div className="mt-2.5">
            <SupplyBy label="Paper supplied by" value={card.paperSupplyBy} />
          </div>
        </Block>

        {/* ---------------------------------------------------------------- */}
        {/* Plate and tooling                                                 */}
        {/* ---------------------------------------------------------------- */}
        <Block title="Plate &amp; job kitting">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Slot label="Plate / job ID" value={card.plateJobId} />
            <div>
              <SupplyBy label="Plate supplied by" value={card.plateSupplyBy} />
            </div>
          </div>

          <div className="mt-2.5">
            <p className="print-label">Job kitting — plates, dies &amp; blocks</p>
            {tooling.length === 0 ? (
              <p className="mt-1 text-[10pt]">
                Nothing recorded against this design.{" "}
                <span className="print-rule w-[45%]" />
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-[10pt]">
                {tooling.map((t) => (
                  <li key={t.id}>
                    <span className="font-bold tabular-nums">{t.toolNo}</span> · {t.name} ·{" "}
                    {/* Where it is kept. The single most-read field in the
                        register (I8), and the one thing somebody sent to fetch
                        a die actually needs off this sheet. */}
                    <span className="font-bold">{t.location}</span>
                    {t.condition !== "Good" ? ` · ${t.condition}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Block>

        {/* ---------------------------------------------------------------- */}
        {/* Machine                                                           */}
        {/* ---------------------------------------------------------------- */}
        {/* One line, with the label inline. A boxed section titled "Machine"
            containing a field labelled "Machine" printed the word twice and
            spent a quarter of the sheet's remaining height doing it. */}
        <p className="print-avoid-break print-box mt-2 flex items-baseline gap-2 px-2 py-1.5">
          <span className="print-section-title">Machine</span>
          {card.machineDetail ? (
            <span className="print-value">{card.machineDetail}</span>
          ) : (
            <span className="print-rule flex-1" />
          )}
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* Fabrication                                                       */}
        {/* ---------------------------------------------------------------- */}
        <Block title="Fabrication &amp; finishing">
          {/* Sentence case, not the uppercase label style: this is an
              instruction to read, and a whole line of capitals is read as
              shouting and then skipped. */}
          <p className="print-hint mb-1.5">
            Ticked from the design&rsquo;s route. Write the detail beside each — matt/gloss,
            gold/silver, new/old die.
          </p>

          {/* EVERY process stage is printed, not only the ones on the route
              (J5). A printed form lists all its options: showing only the route
              would leave an operator with nowhere to tick a process added on
              the day, and the paper card being replaced prints every line. */}
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {processes.map((p) => (
              <li key={p.code} className="flex items-baseline gap-1.5 text-[10.5pt]">
                <span className="print-check">{p.onRoute ? "✓" : ""}</span>
                <span className={p.onRoute ? "font-bold" : ""}>{p.name}</span>
                <span className="print-rule flex-1" />
              </li>
            ))}
          </ul>
        </Block>

        {/* ---------------------------------------------------------------- */}
        {/* After the run — ALWAYS BLANK                                      */}
        {/* ---------------------------------------------------------------- */}
        <Block title="After the run — fill in by hand">
          <div className="grid grid-cols-2 gap-x-6">
            <div>
              <p className="print-label">Final quantity</p>
              <div className="print-hairline mt-6" />
            </div>
            <div>
              <p className="print-label">Wastage</p>
              <div className="print-hairline mt-6" />
            </div>
          </div>

          <div className="mt-3">
            <p className="print-label">Remarks</p>
            <div className="print-hairline mt-6" />
            <div className="print-hairline mt-6" />
          </div>
        </Block>

        <footer className="print-avoid-break mt-4 grid grid-cols-3 gap-x-8">
          {["Operator", "Supervisor", "Checked by"].map((role) => (
            <div key={role}>
              <div className="print-hairline mt-8" />
              <p className="print-label mt-1">{role}</p>
            </div>
          ))}
        </footer>

        <p className="mt-4 text-[8pt] text-neutral-600">
          {card.jcNo} · printed from JSS MIS. Final quantity, wastage and remarks are
          recorded on this sheet by hand and typed back into the system afterwards.
        </p>
      </article>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sheet primitives                                                            */
/* -------------------------------------------------------------------------- */

/** A titled, boxed section. Every block on the form has the same frame. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print-avoid-break print-box mt-2 px-2 py-1.5">
      <h2 className="print-section-title mb-1.5">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return <div className={`flex ${last ? "" : "border-b border-neutral-400"}`}>{children}</div>;
}

/** A label/value pair inside the top identification box. */
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
    <div className={`min-w-0 border-r border-neutral-400 px-2 py-1 last:border-r-0 ${grow ? "flex-1" : ""}`}>
      <p className="print-label">{label}</p>
      <p className={`print-value ${strong ? "font-bold" : ""}`}>
        {value && value.trim() !== "" ? value : <span className="print-rule w-24" />}
      </p>
    </div>
  );
}

/**
 * A field the system may or may not know.
 *
 * A known value prints. An unknown one prints a rule, which is the whole
 * convention of this sheet: the floor fills the gap in ink (J5).
 */
function Slot({
  label,
  value,
  wide,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-full" : ""}>
      <p className="print-label">{label}</p>
      {value && value.trim() !== "" ? (
        <p className="print-value">{value}</p>
      ) : (
        <span className="print-rule w-full" />
      )}
    </div>
  );
}

/**
 * Press / Party, as two tick boxes.
 *
 * Printed as boxes rather than as the word alone so an unset value is still
 * usable: both boxes empty means nobody had decided when the card was raised,
 * and the person who does decide ticks one in ink. A default of 'Press' in the
 * database would have printed a guess as a fact.
 */
function SupplyBy({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="text-[10.5pt]">
      <span className="print-label">{label}:</span>{" "}
      <span className="ml-1.5 inline-flex items-baseline gap-1.5">
        <span className="print-check">{value === "Press" ? "✓" : ""}</span> Press
      </span>
      <span className="ml-4 inline-flex items-baseline gap-1.5">
        <span className="print-check">{value === "Party" ? "✓" : ""}</span> Party
      </span>
    </p>
  );
}
