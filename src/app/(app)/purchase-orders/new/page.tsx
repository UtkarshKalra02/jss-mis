import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { PoForm } from "@/components/purchase-orders/po-form";
import { Button } from "@/components/ui/button";
import { listClientOptions } from "@/modules/designs/queries";
import {
  listConfirmationTakers,
  listDesignOptions,
  listRepeatableItemOptions,
} from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "Capture PO · JSS MIS" };

export default async function NewPurchaseOrderPage() {
  // "create", not "write": the PLANNER may capture a PO and nothing more (P5).
  // W: the signed-in person is the default answer to "who took the confirmation".
  const actor = await requireAccess("purchase_order", "create");

  // K20a: whether the client box may invent a client, or only find one.
  const canCreateClient = can(actor.role, "client", "create");

  const [clients, designs, repeatableItems, confirmationTakers] = await Promise.all([
    listClientOptions(),
    listDesignOptions(),
    listRepeatableItemOptions(),
    listConfirmationTakers(),
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
        {/*
          The empty client master only blocks somebody who cannot fix it
          (K20a). Whoever may create a client types the first one into the
          capture form itself; sending them to /clients/new to come back and
          start again is a detour that exists only because this branch used to
          be unconditional.
        */}
        {clients.length === 0 && !canCreateClient ? (
          <div className="rounded-lg border border-dashed p-6">
            <h2 className="text-sm font-medium">There are no clients yet</h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              A purchase order comes from a client, and there are none yet. Your role can choose a client but not create one, so somebody with
              client access has to add the first.
            </p>
          </div>
        ) : (
          <PoForm
            clients={clients}
            canCreateClient={canCreateClient}
            designs={designs}
            repeatableItems={repeatableItems}
            confirmationTakers={confirmationTakers}
            defaultConfirmedBy={actor.id}
          />
        )}
      </div>
    </div>
  );
}
