import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { clientColumns } from "@/modules/clients/columns";
import { listClients } from "@/modules/clients/queries";

export const metadata: Metadata = { title: "Clients · JSS MIS" };

export default async function ClientsPage() {
  // Read is enough to see the list; ADMIN alone gets the Add button (A3).
  const user = await requireAccess("client");
  const canWrite = can(user.role, "client", "write");

  const clients = await listClients();

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Clients</h1>
        {canWrite ? (
          <Button asChild size="sm">
            <Link href="/clients/new">Add client</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {canWrite
          ? "Sort by any column, or filter inline under Code, Name and City."
          : "Read-only. Ask an administrator to add or change a client."}
      </p>

      <div className="mt-6">
        <DataTable
          columns={clientColumns}
          data={clients}
          emptyMessage={
            canWrite
              ? "No clients yet. Add the first one to get started."
              : "No clients yet."
          }
        />
      </div>
    </div>
  );
}
