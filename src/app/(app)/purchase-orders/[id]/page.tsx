import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import {
  PoHeaderForm,
  PoItemForm,
  PurchaseOrderControls,
} from "@/components/purchase-orders/po-controls";
import { StagePill } from "@/components/stages/stage-pill";
import { listClientOptions } from "@/modules/designs/queries";
import {
  getPurchaseOrder,
  listDesignOptions,
  listPoItems,
} from "@/modules/purchase-orders/queries";
import {
  formatCommittedDate,
  formatDaysToCommitted,
  formatINRPrecise,
  formatQty,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Purchase order · JSS MIS" };

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("purchase_order");
  const canWrite = can(user.role, "purchase_order", "write");

  const { id } = await params;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();

  const [items, clients, designs] = await Promise.all([
    listPoItems(id),
    listClientOptions(),
    listDesignOptions(),
  ]);

  const designsForClient = designs.filter((d) => d.clientId === po.clientId);

  return (
    <div>
      <Link
        href="/purchase-orders"
        className="text-muted-foreground text-[13px] hover:underline"
      >
        ← Purchase orders
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="page-title tabular-nums">{po.internalNo}</h1>
        <span className="text-muted-foreground text-[13px]">
          {po.clientCode} — {po.clientName}
          {po.poNo ? ` · their PO ${po.poNo}` : ""}
        </span>
        <span
          className={cn(
            "text-[13px]",
            po.status === "Cancelled" && "text-muted-foreground",
            po.status === "Closed" && "text-on-time",
          )}
        >
          {po.status}
        </span>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="px-3">Item</th>
              <th className="px-3">Name</th>
              <th className="px-3">Design</th>
              <th className="px-3 text-right">Ordered</th>
              <th className="px-3 text-right">Dispatched</th>
              <th className="px-3 text-right">Pending</th>
              <th className="px-3">Stage</th>
              <th className="px-3">Committed</th>
              <th className="px-3 text-right">Rate</th>
              <th className="px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-muted-foreground px-3 py-6 text-center">
                  No items on this PO yet.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3">
                    {canWrite ? (
                      <Link
                        href={`/purchase-orders/${id}/items/${item.id}`}
                        className="text-primary tabular-nums hover:underline"
                      >
                        {item.itemCode}
                      </Link>
                    ) : (
                      <span className="tabular-nums">{item.itemCode}</span>
                    )}
                  </td>
                  <td className="px-3">{item.itemName}</td>
                  <td className="text-muted-foreground px-3">
                    {item.designCode ? `${item.designCode}` : "—"}
                  </td>
                  <td className="px-3 text-right tabular-nums">{formatQty(item.orderedQty)}</td>
                  <td className="px-3 text-right tabular-nums">
                    {formatQty(item.dispatchedQty)}
                  </td>
                  <td className="px-3 text-right tabular-nums">{formatQty(item.pendingQty)}</td>
                  <td className="px-3">
                    <StagePill name={item.currentStageName} colour={item.currentStageColour} />
                  </td>
                  <td className="px-3">
                    {/* F8: a null commitment says so, rather than showing blank. */}
                    <span
                      className={cn(
                        item.isOverdue && "text-overdue",
                        item.isAtRisk && "text-at-risk",
                        !item.committedDate && "text-muted-foreground text-[11px]",
                      )}
                    >
                      {formatCommittedDate(item.committedDate)}
                    </span>
                    {item.committedDate && item.status === "Open" ? (
                      <span className="text-muted-foreground ml-2 text-[11px]">
                        {formatDaysToCommitted(item.daysToCommitted)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 text-right tabular-nums">{formatINRPrecise(item.rate)}</td>
                  <td
                    className={cn(
                      "px-3",
                      item.status === "Cancelled" && "text-muted-foreground line-through",
                      item.status === "Closed" && "text-on-time",
                    )}
                  >
                    {item.status}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <div className="mt-8 max-w-3xl space-y-4">
          <PoHeaderForm po={po} clients={clients} />
          <PoItemForm mode="add" purchaseOrderId={id} designs={designsForClient} />
          <PurchaseOrderControls poId={po.id} internalNo={po.internalNo} status={po.status} />
        </div>
      ) : (
        <p className="text-muted-foreground mt-8 text-sm">
          Read-only. Ask the order desk to change a purchase order.
        </p>
      )}
    </div>
  );
}
