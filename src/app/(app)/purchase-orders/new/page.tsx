import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { PoForm } from "@/components/purchase-orders/po-form";
import { Button } from "@/components/ui/button";
import { listClientOptions } from "@/modules/designs/queries";
import { listDesignOptions } from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "Capture PO · JSS MIS" };

export default async function NewPurchaseOrderPage() {
  await requireAccess("purchase_order", "write");

  const [clients, designs] = await Promise.all([listClientOptions(), listDesignOptions()]);

  return (
    <div>
      <Link
        href="/purchase-orders"
        className="text-muted-foreground text-[13px] hover:underline"
      >
        ← Purchase orders
      </Link>
      <h1 className="page-title mt-2">Capture purchase order</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Numbers are allocated on save. Every item gets a PO_RECEIVED stage event dated by the
        PO, so a PO entered late reads as late rather than as new.
      </p>

      <div className="mt-8">
        {clients.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6">
            <h2 className="text-sm font-medium">Add a client first</h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              A purchase order comes from a client, and there are none yet.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/clients/new">Add a client</Link>
            </Button>
          </div>
        ) : (
          <PoForm clients={clients} designs={designs} />
        )}
      </div>
    </div>
  );
}
