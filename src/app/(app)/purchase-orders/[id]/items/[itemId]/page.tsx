import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { PoItemControls, PoItemForm } from "@/components/purchase-orders/po-controls";
import {
  dispatchedQtyFor,
  getPoItem,
  getPurchaseOrder,
  listDesignOptions,
} from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "PO item · JSS MIS" };

export default async function PoItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  await requireAccess("purchase_order", "write");

  const { id, itemId } = await params;
  const [po, item] = await Promise.all([getPurchaseOrder(id), getPoItem(itemId)]);

  if (!po || !item || item.purchaseOrderId !== id) notFound();

  const [designs, dispatchedQty] = await Promise.all([
    listDesignOptions(),
    dispatchedQtyFor(itemId),
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
      </div>
    </div>
  );
}
