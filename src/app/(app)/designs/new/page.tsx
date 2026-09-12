import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { DesignForm } from "@/components/designs/design-form";
import { Button } from "@/components/ui/button";
import { listClientOptions } from "@/modules/designs/queries";
import { fabricationVocabulary } from "@/modules/fabrication/queries";

export const metadata: Metadata = { title: "New design · JSS MIS" };

export default async function NewDesignPage() {
  const user = await requireAccess("design", "write");
  const canCreateClient = can(user.role, "client", "create");

  const [clients, fabricationOptions] = await Promise.all([
    listClientOptions(),
    fabricationVocabulary(),
  ]);

  return (
    <div className="max-w-3xl">
      <Link href="/designs" className="text-muted-foreground text-[13px] hover:underline">
        ← Designs
      </Link>
      <h1 className="page-title mt-2">New design</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        The design code is allocated on save. It is not year-scoped — a die outlives any
        financial year.
      </p>

      <div className="mt-8">
        {clients.length === 0 && !canCreateClient ? (
          /* Only for somebody who cannot create one (K19). With the picker, an
             empty client master is no longer a dead end — you type the name and
             it is created on save. This block survives for PLANNER and ACCOUNTS,
             for whom the form genuinely cannot be completed. */
          <div className="rounded-lg border border-dashed p-6">
            <h2 className="text-sm font-medium">A client has to exist first</h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Every design belongs to one client, there are none yet, and your role cannot
              create one. Ask an admin or the order desk to add the client, then come back.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href="/designs">Back to designs</Link>
            </Button>
          </div>
        ) : (
          <DesignForm
            mode="create"
            clients={clients}
            canCreateClient={canCreateClient}
            fabricationOptions={fabricationOptions}
            fabricationSelected={new Map()}
          />
        )}
      </div>
    </div>
  );
}
