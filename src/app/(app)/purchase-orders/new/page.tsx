import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { PoForm } from "@/components/purchase-orders/po-form";
import { Button } from "@/components/ui/button";
import { listClientOptions } from "@/modules/designs/queries";
import { listDesignOptions, listOpenItemOptions } from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "Capture PO · JSS MIS" };

export default async function NewPurchaseOrderPage() {
  // "create", not "write": the PLANNER may capture a PO and nothing more (P5).
  await requireAccess("purchase_order", "create");

  const [clients, designs, openItems] = await Promise.all([
    listClientOptions(),
    listDesignOptions(),
    listOpenItemOptions(),
  ]);

  return (
    <div>
      <Link
        href="/purchase-orders"
        className="text-muted-foreground text-[13px] hover:underline"
      >
        ← Purchase orders
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="page-title">Capture purchase order</h1>
        <div className="flex items-center gap-2">
          {/* N1: the PO is often the last thing to arrive. */}
          <Button asChild size="sm" variant="outline">
            <Link href="/items/new">No PO yet? Add the items anyway</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/purchase-orders/import">Have a spreadsheet? Import instead</Link>
          </Button>
        </div>
      </div>
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
          <PoForm clients={clients} designs={designs} openItems={openItems} />
        )}
      </div>
    </div>
  );
}
