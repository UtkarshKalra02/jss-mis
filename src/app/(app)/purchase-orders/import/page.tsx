import type { Metadata } from "next";

import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { ImportHistory } from "@/components/imports/import-history";
import { ImportScreen } from "@/components/imports/import-screen";
import { Button } from "@/components/ui/button";
import { listClientsForImport, listImportBatches } from "@/modules/imports/queries";

export const metadata: Metadata = { title: "Import · JSS MIS" };

/**
 * Bulk entry of historical jobs.
 *
 * NOT the primary entry path — the forms are. This exists for the ~40 completed
 * jobs sitting in paper books, and for batch catch-up afterwards.
 */
export default async function ImportPage() {
  await requireAccess("import", "write");

  const [batches, clients] = await Promise.all([listImportBatches(), listClientsForImport()]);

  return (
    <div>
      <h1 className="page-title">Import historical jobs</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        One row per job. Every row is checked and shown to you before anything is written,
        and a whole import can be undone in one action.
      </p>

      {/* With no clients, every single row would be refused with "no client
          matches" — which reads as a broken importer rather than as a missing
          prerequisite. The importer never creates clients (F29), so say that
          before the file is uploaded rather than forty times afterwards. */}
      {clients.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed p-6">
          <h2 className="text-sm font-medium">Add your clients first</h2>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Every row is matched to an existing client by name or code, and the importer
            never creates one — three spellings of a customer is a mess nobody notices
            until a report is split three ways. With no clients on file, every row in your
            spreadsheet will be refused.
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link href="/clients/new">Add a client</Link>
          </Button>
        </div>
      ) : null}

      <div className="mt-6">
        <ImportScreen />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Import history</h2>
        <div className="mt-3">
          <ImportHistory batches={batches} />
        </div>
      </section>
    </div>
  );
}
