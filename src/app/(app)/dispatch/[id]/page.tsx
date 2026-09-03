import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import {
  AddDispatchLine,
  DispatchCancelControl,
  DispatchHeaderForm,
  RemoveDispatchLine,
} from "@/components/dispatches/dispatch-controls";
import { StagePill } from "@/components/stages/stage-pill";
import { formatDate, formatINRPrecise, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getDispatch,
  listDispatchableItems,
  listDispatchLines,
} from "@/modules/dispatches/queries";

export const metadata: Metadata = { title: "Challan · JSS MIS" };

export default async function DispatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("dispatch");
  const canWrite = can(user.role, "dispatch", "write");

  const { id } = await params;
  const head = await getDispatch(id);
  if (!head) notFound();

  const [lines, dispatchable] = await Promise.all([
    listDispatchLines(id),
    listDispatchableItems(),
  ]);

  // A challan cannot mix clients (C8), and an item already on this one is not
  // a candidate to add again.
  const onThisChallan = new Set(lines.map((l) => l.poItemId));
  const candidates = dispatchable.filter(
    (i) => i.clientId === head.clientId && !onThisChallan.has(i.poItemId),
  );

  const cancelled = head.status === "Cancelled";
  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <div>
      <Link href="/dispatch" className="text-muted-foreground text-[13px] hover:underline">
        ← Dispatch
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="page-title tabular-nums">{head.challanNo}</h1>
        <span className="text-muted-foreground text-[13px]">
          {head.clientCode} — {head.clientName} · {formatDate(head.dispatchDate)}
        </span>
        <span
          className={cn("text-[13px]", cancelled && "text-muted-foreground line-through")}
        >
          {head.status}
        </span>
      </div>

      {cancelled ? (
        <p className="border-at-risk/40 bg-at-risk-bg mt-4 rounded-lg border p-3 text-[13px]">
          This challan is cancelled, so it consumes no order quantity — everything on it is
          owed again. The lines below are kept as the record of what was entered.
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="px-3">Item</th>
              <th className="px-3">Name</th>
              <th className="px-3">Stage</th>
              <th className="px-3 text-right">Ordered</th>
              <th className="px-3 text-right">On this challan</th>
              <th className="px-3 text-right">Still pending</th>
              <th className="px-3 text-right">Rate</th>
              {canWrite && !cancelled ? <th className="w-20 px-3"></th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-3 py-6 text-center">
                  No lines on this challan.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3">
                    <Link
                      href={`/items/${line.poItemId}`}
                      className="text-primary tabular-nums hover:underline"
                    >
                      {line.itemCode}
                    </Link>
                  </td>
                  <td className="px-3">{line.itemName}</td>
                  <td className="px-3">
                    <StagePill name={line.currentStageName} colour={line.currentStageColour} />
                  </td>
                  <td className="px-3 text-right tabular-nums">{formatQty(line.orderedQty)}</td>
                  <td className="px-3 text-right tabular-nums">{formatQty(line.qty)}</td>
                  <td
                    className={cn(
                      "px-3 text-right tabular-nums",
                      line.pendingQty === 0 && "text-muted-foreground",
                    )}
                  >
                    {formatQty(line.pendingQty)}
                  </td>
                  <td className="px-3 text-right tabular-nums">{formatINRPrecise(line.rate)}</td>
                  {canWrite && !cancelled ? (
                    <td className="px-3 text-right">
                      <RemoveDispatchLine
                        lineId={line.id}
                        dispatchId={id}
                        itemCode={line.itemCode}
                      />
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
          {lines.length > 0 ? (
            <tfoot>
              <tr className="border-t font-medium">
                <td className="px-3 py-2" colSpan={4}>
                  {lines.length} line{lines.length === 1 ? "" : "s"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(totalQty)}</td>
                <td colSpan={canWrite && !cancelled ? 3 : 2}></td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {canWrite ? (
        <div className="mt-8 max-w-3xl space-y-4">
          <DispatchHeaderForm head={head} />
          {!cancelled ? (
            <AddDispatchLine dispatchId={id} candidates={candidates} />
          ) : null}
          <DispatchCancelControl
            dispatchId={head.id}
            challanNo={head.challanNo}
            status={head.status}
          />
        </div>
      ) : (
        <p className="text-muted-foreground mt-8 text-sm">Read-only.</p>
      )}
    </div>
  );
}
