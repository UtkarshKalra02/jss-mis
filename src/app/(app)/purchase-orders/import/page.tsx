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
        and a whole import can be undone in one action — including any clients it created.
      </p>

      {/* With nothing on file to match against, every client in the file is
          new by definition and the import would create the whole customer list
          from a spreadsheet — each with a generated code and nothing else.
          Since F32 that WORKS, which is precisely why it is worth saying
          beforehand rather than discovering afterwards. */}
      {clients.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed p-6">
          <h2 className="text-sm font-medium">There are no clients on file yet</h2>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Rows are matched to existing clients by name or code, and a name that resembles
            nothing on file is created automatically. With an empty client list that means
            every customer in your spreadsheet gets created from it, each with a generated
            code and no GSTIN or address. That is a legitimate way to start, but adding the
            ones you already know first gives them proper records to match against.
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
