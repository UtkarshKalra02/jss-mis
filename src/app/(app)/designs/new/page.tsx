import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { DesignForm } from "@/components/designs/design-form";
import { Button } from "@/components/ui/button";
import { listClientOptions, listRouteStages } from "@/modules/designs/queries";

export const metadata: Metadata = { title: "New design · JSS MIS" };

export default async function NewDesignPage() {
  await requireAccess("design", "write");

  const [clients, stages] = await Promise.all([listClientOptions(), listRouteStages()]);

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
        {clients.length === 0 ? (
          /* A design belongs to one client, so with no clients this form can
             never be saved. Presenting an empty dropdown just looks broken. */
          <div className="rounded-lg border border-dashed p-6">
            <h2 className="text-sm font-medium">Add a client first</h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Every design belongs to one client, and there are none yet. The importer
              will not create them either — three spellings of one customer is a mess
              nobody notices until a report is split three ways.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/clients/new">Add a client</Link>
            </Button>
          </div>
        ) : (
          <DesignForm mode="create" clients={clients} stages={stages} selectedProcesses={[]} />
        )}
      </div>
    </div>
  );
}
