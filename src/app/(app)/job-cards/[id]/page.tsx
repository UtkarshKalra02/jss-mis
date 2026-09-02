import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { ExecutionForm } from "@/components/job-cards/execution-form";
import { Button } from "@/components/ui/button";
import { formatCommittedDate, formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getJobCard, processChecklistFor } from "@/modules/job-cards/queries";
import { toolingForDesign } from "@/modules/tooling/queries";

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
 * There is no sidebar entry, on the same reasoning as the press run screen
 * (H5): a card is reached from the job it belongs to, and a list of every card
 * ever printed answers no question anybody has.
 */
export default async function JobCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("job_card");
  const canWrite = can(user.role, "job_card", "write");

  const { id } = await params;
  const card = await getJobCard(id);
  if (!card) notFound();

  const [processes, tooling] = await Promise.all([
    processChecklistFor(card.designId),
    card.designId ? toolingForDesign(card.designId) : Promise.resolve([]),
  ]);

  const onRoute = processes.filter((p) => p.onRoute);

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

      {/* The plan. What was decided before the sheet was printed. */}
      <dl className="mt-6 grid gap-x-8 gap-y-3 rounded-lg border p-4 text-[13px] sm:grid-cols-3">
        <Fact label="Quantity to run" value={formatQty(card.plannedQty)} />
        <Fact label="Ordered" value={formatQty(card.orderedQty)} />
        <Fact label="Committed" value={formatCommittedDate(card.committedDate)} />

        <Fact label="Planned date" value={formatDate(card.plannedDate)} />
        <Fact label="Machine" value={card.machineDetail} />
        <Fact label="Plate / Job ID" value={card.plateJobId} />

        <Fact label="Paper supplied by" value={card.paperSupplyBy} />
        <Fact label="Plate supplied by" value={card.plateSupplyBy} />
        <Fact label="Card raised" value={formatDate(card.createdAt)} />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Paper</h2>
          {card.designId ? (
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
              <Fact label="Design" value={`${card.designCode} · ${card.designJobName}`} />
              <Fact label="Size" value={card.designJobSize} />
              <Fact label="GSM" value={card.designGsm} />
              <Fact label="Type" value={card.designPaperType} />
              <Fact label="Print" value={card.designPrintType} />
              <Fact label="Colours" value={card.designNoOfColours} />
            </dl>
          ) : (
            <p className="text-muted-foreground mt-3 text-[13px]">
              No design against this item, so there is no paper specification to show. The
              printed card leaves these lines blank for hand entry.
            </p>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Fabrication</h2>
          {onRoute.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-[13px]">
              No processes recorded on this design&rsquo;s route. The printed card still lists
              every process with an empty box, so the floor can tick what applies.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {onRoute.map((p) => (
                <li
                  key={p.code}
                  className="bg-neutral-status-bg rounded-full px-2.5 py-0.5 text-[12px]"
                >
                  {p.name}
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-5 text-sm font-medium">Tooling</h2>
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
                  <span className="font-medium">{t.location}</span>
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

      {card.notes ? (
        <p className="bg-neutral-status-bg text-muted-foreground mt-6 rounded-md px-3 py-2 text-[13px]">
          {card.notes}
        </p>
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
