import type { Metadata } from "next";
import Link from "next/link";

import { Suspense } from "react";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { ImportedFilter } from "@/components/clients/imported-filter";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { clientColumns } from "@/modules/clients/columns";
import { listClients, unreviewedImportedClientCount } from "@/modules/clients/queries";

export const metadata: Metadata = { title: "Clients · JSS MIS" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string }>;
}) {
  // Read is enough to see the list; ADMIN alone gets the Add button (A3).
  const user = await requireAccess("client");
  const canWrite = can(user.role, "client", "write");

  const { imported } = await searchParams;
  const importedUnreviewed = imported === "1";

  const [clients, unreviewedCount] = await Promise.all([
    listClients({ importedUnreviewed }),
    unreviewedImportedClientCount(),
  ]);

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

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Suspense fallback={null}>
          <ImportedFilter enabled={importedUnreviewed} unreviewedCount={unreviewedCount} />
        </Suspense>
      </div>

      {importedUnreviewed ? (
        <p className="bg-neutral-status-bg text-muted-foreground mt-4 rounded-md px-3 py-2 text-[13px]">
          Clients the importer created because nothing on file resembled the name in a
          spreadsheet (F32). Each has a generated code and nothing else — open one, finish
          the record, and mark it checked to take it off this list.
        </p>
      ) : null}

      <div className="mt-6">
        <DataTable
          columns={clientColumns}
          data={clients}
          emptyMessage={
            importedUnreviewed
              ? "Nothing waiting. Every client the importer created has been checked."
              : canWrite
                ? "No clients yet. Add the first one to get started."
                : "No clients yet."
          }
        />
      </div>
    </div>
  );
}
