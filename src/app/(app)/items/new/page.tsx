import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { PoForm } from "@/components/purchase-orders/po-form";
import { Button } from "@/components/ui/button";
import { listClientOptions } from "@/modules/designs/queries";
import { listDesignOptions, listOpenItemOptions } from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "Add item · JSS MIS" };

/**
 * Items whose PO has not arrived (N1).
 *
 * The client's PO often follows the work — sometimes it follows the dispatch.
 * This is the capture form in item mode: no PO number, no scan, an order date
 * instead of a PO date. The items go in under an order marked PO awaited, get
 * job cards and challans like any other, and the number is recorded on the
 * order's page when the document turns up.
 *
 * Gated on purchase_order write, not item_tracker: whoever adds an item is
 * doing the order desk's job, and the tracker's readers (FLOOR, OWNER) are not
 * given a way to create work from the screen that reports it.
 */
export default async function NewItemPage() {
  await requireAccess("purchase_order", "write");

  const [clients, designs, openItems] = await Promise.all([
    listClientOptions(),
    listDesignOptions(),
    listOpenItemOptions(),
  ]);

  return (
    <div>
      <Link href="/items" className="text-muted-foreground text-[13px] hover:underline">
        ← Item tracker
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="page-title">Add item</h1>
        <Button asChild size="sm" variant="outline">
          <Link href="/purchase-orders/new">Have the PO? Capture it instead</Link>
        </Button>
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        For work that starts before the client&rsquo;s PO arrives. The items are saved under an
        order marked PO awaited; job cards and dispatch work as usual. Committed date is still
        required — the promise was made, PO or not.
      </p>

      <div className="mt-8">
        {clients.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6">
            <h2 className="text-sm font-medium">Add a client first</h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              An item belongs to a client, and there are none yet.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/clients/new">Add a client</Link>
            </Button>
          </div>
        ) : (
          <PoForm mode="item" clients={clients} designs={designs} openItems={openItems} />
        )}
      </div>
    </div>
  );
}
