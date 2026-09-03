import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { ExecutionForm } from "@/components/job-cards/execution-form";
import { JobCardForm } from "@/components/job-cards/job-card-form";
import {
  JobCardStatusPanel,
  RemoveJobCardCard,
} from "@/components/job-cards/job-card-status";
import { Button } from "@/components/ui/button";
import { formatCommittedDate, formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  designSelections,
  fabricationVocabulary,
  jobCardSelections,
  printedChecklist,
} from "@/modules/fabrication/queries";
import { getJobCard, machineOptions } from "@/modules/job-cards/queries";
import { toolingForDesign } from "@/modules/tooling/queries";
import { locationLabel } from "@/modules/tooling/location";

export const metadata: Metadata = { title: "Job card · JSS MIS" };

/**
 * One job card.
 *
 * Everything on this screen except the run figures belongs to something else —
 * the item, its order, its client, its design, and the tooling that design
 * needs. That is the point: a job card is the one place those five things are
 * assembled into a single sheet somebody can work from, and this screen is
 * that assembly on a monitor while `/job-cards/[id]/print` is the same
 * assembly on A4.
 *
 * Reached from the Job Cards list, from the item it belongs to, or from a
 * press run. It briefly had no list screen at all, on the press run's
 * reasoning (H5) — that was wrong for a document the floor works from daily,
 * and the list now exists.
 */
export default async function JobCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("job_card");
  const canWrite = can(user.role, "job_card", "write");

  const { id } = await params;
  const card = await getJobCard(id);
  if (!card) notFound();

  const [vocabulary, cardFab, tooling, machines] = await Promise.all([
    fabricationVocabulary(),
    jobCardSelections(id),
    card.designId ? toolingForDesign(card.designId) : Promise.resolve([]),
    machineOptions(),
  ]);

  const designFab = card.designId ? await designSelections(card.designId) : new Map();
  const checklist = printedChecklist(vocabulary, designFab, cardFab);

  const applying = checklist.filter((l) => l.applies);

  /*
   * Run-scope questions the design has opened and nobody has answered.
   *
   * The printed card no longer carries a blank rule for these (J8) — the only
   * thing left empty on the page is the run figures — so a missing answer is a
   * GAP rather than an invitation. This screen says so before somebody prints
   * a sheet with a hole in it.
   */
  const unanswered = checklist.filter((l) => l.awaitingValue);
  const runOptions = vocabulary.filter((o) => o.valueScope === "Run" && designFab.has(o.id));

  return (
    <div className="max-w-4xl">
      <Link
        href={`/items/${card.poItemId}`}
        className="text-muted-foreground text-[13px] hover:underline"
      >
        ← {card.itemCode}
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="page-title tabular-nums">{card.jcNo}</h1>
          <span className="text-[15px]">{card.itemName}</span>
          <span
            className={cn(
              "text-[13px]",
              card.status === "On Hold" && "text-at-risk",
              card.status === "Cancelled" && "text-muted-foreground",
              card.status === "Completed" && "text-on-time",
            )}
          >
            {card.status}
          </span>
        </div>

        <Button asChild size="sm" variant="outline">
          <Link href={`/job-cards/${card.id}/print`}>Print job card</Link>
        </Button>
      </div>

      <p className="text-muted-foreground mt-1 text-[13px]">
        {card.clientCode} — {card.clientName} ·{" "}
        <Link href={`/purchase-orders/${card.purchaseOrderId}`} className="hover:underline">
          {card.poInternalNo}
        </Link>
        {card.pressRunId ? (
          <>
            {" · "}
            <Link href={`/press-runs/${card.pressRunId}`} className="text-primary hover:underline">
              Ganged on {card.runNo}
            </Link>
          </>
        ) : null}
      </p>

      {card.holdReason ? (
        <p className="bg-at-risk-bg text-at-risk mt-4 rounded-md px-3 py-2 text-[13px]">
          On hold — {card.holdReason}
        </p>
      ) : null}

      {unanswered.length > 0 ? (
        <p className="bg-at-risk-bg text-at-risk mt-4 rounded-md px-3 py-2 text-[13px]">
          {unanswered.length === 1
            ? `${unanswered[0]!.label} has no answer yet, and will print blank.`
            : `${unanswered.length} fabrication answers are missing — ${unanswered
                .map((l) => l.label)
                .join(", ")} — and will print blank.`}
        </p>
      ) : null}

      {/* The check list from the paper card's top-left corner (J11). */}
      <div className="mt-6 flex flex-wrap items-baseline gap-4 rounded-lg border px-4 py-3 text-[13px]">
        <span className="text-muted-foreground text-xs tracking-wide uppercase">Check list</span>
        {(
          [
            ["Paper", card.checklistPaper],
            ["Plates", card.checklistPlates],
            ["Colour", card.checklistColour],
          ] as const
        ).map(([label, on]) => (
          <span key={label} className={on ? "text-on-time font-medium" : "text-muted-foreground"}>
            {on ? "✓" : "☐"} {label}
          </span>
        ))}
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-3 rounded-lg border p-4 text-[13px] sm:grid-cols-3">
        <Fact label="Quantity to run" value={formatQty(card.plannedQty)} />
        <Fact label="Ordered" value={formatQty(card.orderedQty)} />
        <Fact label="Committed" value={formatCommittedDate(card.committedDate)} />

        <Fact label="Planned date" value={formatDate(card.plannedDate)} />
        <Fact
          label="Machine"
          value={
            card.machineName
              ? `${card.machineName}${card.machineSheetSize ? ` · ${card.machineSheetSize}` : ""}`
              : null
          }
        />
        <Fact label="Plate / Job ID" value={card.plateJobId} />

        <Fact label="Paper supplied by" value={card.paperSupplyBy} />
        <Fact label="Plate supplied by" value={card.plateSupplyBy} />
        <Fact label="Card raised" value={formatDate(card.createdAt)} />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Paper</h2>
          <p className="text-muted-foreground mt-1 text-[12px]">
            The parent sheet this run prints on, typed on the card — not the design&rsquo;s
            finished size.
          </p>
          <dl className="mt-3 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
            <Fact label="Size" value={card.paperSize} />
            <Fact label="GSM" value={card.paperGsm} />
            <Fact label="Matt / gloss" value={card.paperFinish} />
            <Fact label="Sheets / ream" value={formatQty(card.sheetsPerReam)} />
            <Fact label="No. of colours" value={card.execNoOfColours} />
            <Fact label="Planning" value={card.execPlanning} />
          </dl>
          {card.designId ? (
            <p className="text-muted-foreground mt-3 text-[12px]">
              Design {card.designCode} — {card.designJobName}
              {card.designJobSize ? ` · finished ${card.designJobSize}` : ""}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Fabrication</h2>
          {applying.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-[13px]">
              Nothing recorded on this design. The printed card still lists every process, so
              the shape of the form stays the one the floor knows.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-[13px]">
              {applying.map((line) => (
                <li key={line.optionId} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{line.label}</span>
                  <span
                    className={cn(
                      "font-medium",
                      line.awaitingValue && "text-at-risk font-normal italic",
                    )}
                  >
                    {line.detail ?? (line.awaitingValue ? "not answered" : "")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-5 text-sm font-medium">Job kitting</h2>
          {tooling.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-[13px]">
              Nothing in the register against this design.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-[13px]">
              {tooling.map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/tooling/${t.id}`}
                    className="text-primary tabular-nums hover:underline"
                  >
                    {t.toolNo}
                  </Link>
                  <span>{t.name}</span>
                  {/* Where it is kept — the reason anybody opens the register. */}
                  <span className="font-medium">{locationLabel(t)}</span>
                  <span
                    className={cn(
                      "text-muted-foreground",
                      t.condition === "Damaged" && "text-overdue",
                      t.condition === "Worn" && "text-at-risk",
                    )}
                  >
                    {t.condition}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {card.fabricationRemarks || card.paperRemarks || card.notes ? (
        <div className="bg-neutral-status-bg text-muted-foreground mt-6 space-y-1 rounded-md px-3 py-2 text-[13px]">
          {card.paperRemarks ? <p>Paper — {card.paperRemarks}</p> : null}
          {card.fabricationRemarks ? <p>Fabrication — {card.fabricationRemarks}</p> : null}
          {card.notes ? <p>{card.notes}</p> : null}
        </div>
      ) : null}

      <div className="mt-6">
        {canWrite ? (
          <ExecutionForm
            id={card.id}
            finalQty={card.finalQty}
            wastageQty={card.wastageQty}
            executionRemarks={card.executionRemarks}
            plannedQty={card.plannedQty}
          />
        ) : (
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">After the run</h2>
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-3">
              <Fact label="Final quantity" value={formatQty(card.finalQty)} />
              <Fact label="Wastage" value={formatQty(card.wastageQty)} />
              <Fact label="Remarks" value={card.executionRemarks} />
            </dl>
          </section>
        )}
      </div>

      {/* Where the card is, and the way back out of one raised by mistake
          (J12). Above the edit form, because "cancel this" is a far more
          common thing to want than "correct the sheet size". */}
      {canWrite ? (
        <div className="mt-6">
          <JobCardStatusPanel
            id={card.id}
            status={card.status}
            holdReason={card.holdReason}
          />
        </div>
      ) : null}

      {/* Correcting the card BEFORE it goes to the floor. Deliberately separate
          from the transcription above, so a wastage figure typed a week later
          cannot post a stale copy of the plan over a correction (J6). */}
      {canWrite ? (
        <section className="mt-6 rounded-lg border p-4">
          <h2 className="mb-4 text-sm font-medium">Edit the card</h2>
          <JobCardForm
            mode="edit"
            itemCode={card.itemCode}
            card={card}
            machines={machines}
            runOptions={runOptions}
            runSelected={cardFab}
          />
        </section>
      ) : null}

      {canWrite ? (
        <div className="mt-6">
          <RemoveJobCardCard id={card.id} jcNo={card.jcNo} />
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5">{value && value.trim() !== "" ? value : "—"}</dd>
    </div>
  );
}
