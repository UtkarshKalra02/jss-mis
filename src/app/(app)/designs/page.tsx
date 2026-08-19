import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { designColumns } from "@/modules/designs/columns";
import { listDesigns } from "@/modules/designs/queries";

export const metadata: Metadata = { title: "Designs · JSS MIS" };

export default async function DesignsPage() {
  const user = await requireAccess("design");
  const canWrite = can(user.role, "design", "write");

  const designs = await listDesigns();

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Designs</h1>
        {canWrite ? (
          <Button asChild size="sm">
            <Link href="/designs/new">Add design</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Reusable job specifications. Filter inline under Code, Client, Job and Paper.
      </p>

      <div className="mt-6">
        <DataTable
          columns={designColumns}
          data={designs}
          emptyMessage={
            canWrite
              ? "No designs yet. Add the first one, or create it while entering a PO."
              : "No designs yet."
          }
        />
      </div>
    </div>
  );
}
