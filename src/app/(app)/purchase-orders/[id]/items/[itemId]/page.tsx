import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { JOB_CLOSE_ROLES, can } from "@/auth/roles";
import {
  PoItemCloseControl,
  PoItemControls,
  PoItemForm,
} from "@/components/purchase-orders/po-controls";
import {
  dispatchedQtyFor,
  getPoItem,
  getPurchaseOrder,
  listDesignOptions,
  manualCloseEligibility,
  userName,
} from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "PO item · JSS MIS" };

/**
 * READ, not WRITE, since section X.
 *
 * This page was write-guarded, which meant OWNER could see a purchase order and
 * every item on it but not an item's own page — an inconsistency with J26,
 * which gave him read on every operational screen. It now matters practically:
 * closing a job by hand is his to do, and the control lives here.
 *
 * Nothing is newly exposed. Every role that can read purchase_order already
 * sees all of this on /purchase-orders/[id]; this page is the same data on a
 * narrower screen. What a reader may DO with it is gated below.
 */
export default async function PoItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const user = await requireAccess("purchase_order");
  const canWrite = can(user.role, "purchase_order", "write");
  const canCloseJobs = JOB_CLOSE_ROLES.has(user.role);

  const { id, itemId } = await params;
  const [po, item] = await Promise.all([getPurchaseOrder(id), getPoItem(itemId)]);

  if (!po || !item || item.purchaseOrderId !== id) notFound();

  const [designs, dispatchedQty, fence, closedByName] = await Promise.all([
    canWrite ? listDesignOptions() : Promise.resolve([]),
    dispatchedQtyFor(itemId),
    canCloseJobs ? manualCloseEligibility(itemId) : Promise.resolve(null),
    item.closedBy ? userName(item.closedBy) : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-3xl">
      <Link
        href={`/purchase-orders/${id}`}
        className="text-muted-foreground text-[13px] hover:underline"
      >
        ← {po.internalNo}
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="page-title tabular-nums">{item.itemCode}</h1>
        <span className="text-muted-foreground text-[13px]">{item.itemName}</span>
      </div>

      <div className="mt-8 space-y-4">
        {canWrite ? (
          <>
            <PoItemForm
              mode="edit"
              purchaseOrderId={id}
              item={item}
              designs={designs.filter((d) => d.clientId === po.clientId)}
            />
            <PoItemControls
              itemId={item.id}
              itemCode={item.itemCode}
              status={item.status}
              dispatchedQty={dispatchedQty}
            />
          </>
        ) : null}

        {canCloseJobs ? (
          <PoItemCloseControl
            itemId={item.id}
            itemCode={item.itemCode}
            pendingQty={Math.max(0, item.orderedQty - dispatchedQty)}
            cancelled={item.status === "Cancelled"}
            closedManuallyAt={item.closedManuallyAt}
            closeReason={item.closeReason}
            closedByName={closedByName}
            fence={fence}
          />
        ) : null}
      </div>
    </div>
  );
}
