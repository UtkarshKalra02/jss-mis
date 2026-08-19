import type { Metadata } from "next";

import { requireAccess } from "@/auth/guard";
import { ImportHistory } from "@/components/imports/import-history";
import { ImportScreen } from "@/components/imports/import-screen";
import { listImportBatches } from "@/modules/imports/queries";

export const metadata: Metadata = { title: "Import · JSS MIS" };

/**
 * Bulk entry of historical jobs.
 *
 * NOT the primary entry path — the forms are. This exists for the ~40 completed
 * jobs sitting in paper books, and for batch catch-up afterwards.
 */
export default async function ImportPage() {
  await requireAccess("import", "write");

  const batches = await listImportBatches();

  return (
    <div>
      <h1 className="page-title">Import historical jobs</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        One row per job. Every row is checked and shown to you before anything is written,
        and a whole import can be undone in one action.
      </p>

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
