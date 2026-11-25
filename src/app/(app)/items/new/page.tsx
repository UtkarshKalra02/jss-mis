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
 * Gated on purchase_order CREATE, not item_tracker: whoever adds an item is
 * doing the order desk's job, and the tracker's readers (FLOOR, OWNER) are not
 * given a way to create work from the screen that reports it.
 *
 * It asked for "write" until 19 Oct 2026, which was wrong in a way nothing
 * caught (U1). This page only ever CREATES, it posts to the same action as
 * /purchase-orders/new, and that action has required only "create" since P5 —
 * so the page was stricter than both the action behind it and the sibling that
 * does strictly more, capturing a real PO with a number and a scan. The effect
 * was that the PLANNER could record a whole purchase order but not a single
 * item awaiting one, which made a job card for an unarrived PO a two-person
 * job. Guards belong at the level of what the screen does, not at the level
 * that feels safest.
 */
export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  // W: the signed-in person is the default answer to "who took the confirmation".
  const actor = await requireAccess("purchase_order", "create");

  // Arrived from "New job card" (U1). One new item goes straight back there,
  // selected, instead of making somebody search for what they just typed.
  const { returnTo } = await searchParams;
  const fromJobCard = returnTo === "job-card";

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
        href={fromJobCard ? "/job-cards/new" : "/items"}
        className="text-muted-foreground text-[13px] hover:underline"
      >
        {fromJobCard ? "← New job card" : "← Item tracker"}
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
              An item belongs to a client, and there are none yet. Your role can choose a client but not create one, so somebody with
              client access has to add the first.
            </p>
          </div>
        ) : (
          <PoForm
            mode="item"
            clients={clients}
            canCreateClient={canCreateClient}
            designs={designs}
            repeatableItems={repeatableItems}
            confirmationTakers={confirmationTakers}
            defaultConfirmedBy={actor.id}
            returnTo={fromJobCard ? "job-card" : undefined}
          />
        )}
      </div>
    </div>
  );
}
