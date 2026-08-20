import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { purchaseOrderColumns } from "@/modules/purchase-orders/columns";
import { listPurchaseOrders } from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "Purchase orders · JSS MIS" };

export default async function PurchaseOrdersPage() {
  const user = await requireAccess("purchase_order");
  const canWrite = can(user.role, "purchase_order", "write");
  const canImport = can(user.role, "import", "write");

  const orders = await listPurchaseOrders();

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Purchase orders</h1>
        {canWrite ? (
          <div className="flex items-center gap-2">
            {canImport ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/purchase-orders/import">Import from Excel</Link>
              </Button>
            ) : null}
            <Button asChild size="sm">
              <Link href="/purchase-orders/new">Capture PO</Link>
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Open counts live items — the same derived definition the Item Tracker uses.
      </p>

      <div className="mt-6">
        <DataTable
          columns={purchaseOrderColumns}
          data={orders}
          emptyMessage={
            canWrite ? "No purchase orders yet. Capture the first one." : "No purchase orders yet."
          }
        />
      </div>
    </div>
  );
}
