import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { RemoveRunCard, RunDetailsForm } from "@/components/press-runs/run-controls";
import { RemoveFromRunButton } from "@/components/press-runs/run-controls";
import { formatDate, formatQty } from "@/lib/format";
import { getPressRun, getRunMembers } from "@/modules/press-runs/queries";

export const metadata: Metadata = { title: "Press run · JSS MIS" };

/**
 * One press run — the jobs printed together on a plate.
 *
 * CROSS-CLIENT IS NORMAL HERE AND IS NOT WARNED ABOUT (decision H3). Everywhere
 * else in this system, two clients on one document is an error the database
 * refuses: a dispatch line whose item belongs to another client, an invoice
 * line likewise (C8). On a plate it is the entire reason the plate exists, so
 * the client column here is information rather than a flag, and nothing on this
 * screen is coloured to suggest otherwise.
 *
 * There is deliberately no cost split, no schedule and no shared stage (H2).
 * The jobs on this run may be at completely different stages, and legitimately
 * so — one goes to lamination after printing, another straight to die-cut.
 *
 * No sidebar entry and no list screen: this is a minority case, reached from
 * the job it belongs to.
 */
export default async function PressRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("press_run");
  const canWrite = can(user.role, "press_run", "write");

  const { id } = await params;
  const run = await getPressRun(id);
  if (!run) notFound();

  const members = await getRunMembers(id);
  const clients = new Set(members.map((m) => m.clientId));

  return (
    <div className="max-w-4xl">
      <Link href="/items" className="text-muted-foreground text-[13px] hover:underline">
        ← Item tracker
      </Link>

      <h1 className="page-title mt-2 tabular-nums">{run.runNo}</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Printed {formatDate(run.runDate)}
        {run.machine ? ` · ${run.machine}` : ""} · {members.length} job
        {members.length === 1 ? "" : "s"}
        {clients.size > 1 ? ` across ${clients.size} clients` : ""}
      </p>

      {run.notes ? (
        <p className="bg-neutral-status-bg text-muted-foreground mt-4 rounded-md px-3 py-2 text-[13px]">
          {run.notes}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-medium">Jobs on this plate</h2>

        {members.length === 0 ? (
          <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-6 text-center text-[13px]">
            Nothing is on this run. Add a job card to it from the item it belongs to.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <table className="data-grid w-full">
              <thead>
                <tr>
                  <th className="px-3">Job card</th>
                  <th className="px-3">Client</th>
                  <th className="px-3">Item</th>
                  <th className="px-3 text-right">Planned</th>
                  <th className="px-3">Status</th>
                  {canWrite ? <th className="w-24 px-3"></th> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.jobCardId}>
                    <td className="px-3 tabular-nums">{m.jcNo}</td>
                    {/* Plain text, no warning colour: several clients on one
                        plate is what ganging IS. */}
                    <td className="px-3">
                      <span className="text-muted-foreground tabular-nums">{m.clientCode}</span>{" "}
                      {m.clientName}
                    </td>
                    <td className="px-3">
                      <Link
                        href={`/items/${m.poItemId}`}
                        className="text-primary hover:underline"
                      >
                        {m.itemName}
                      </Link>
                    </td>
                    <td className="px-3 text-right tabular-nums">{formatQty(m.plannedQty)}</td>
                    <td className="px-3">{m.status}</td>
                    {canWrite ? (
                      <td className="px-3">
                        <RemoveFromRunButton jobCardId={m.jobCardId} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canWrite ? (
        <div className="mt-8 space-y-6">
          <RunDetailsForm run={run} />
          <RemoveRunCard run={run} memberCount={members.length} />
        </div>
      ) : null}
    </div>
  );
}
