import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { dispatchColumns } from "@/modules/dispatches/columns";
import { listDispatches } from "@/modules/dispatches/queries";

export const metadata: Metadata = { title: "Dispatch · JSS MIS" };

export default async function DispatchPage() {
  const user = await requireAccess("dispatch");
  const canWrite = can(user.role, "dispatch", "write");

  const dispatches = await listDispatches();

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Dispatch</h1>
        {canWrite ? (
          <Button asChild size="sm">
            <Link href="/dispatch/new">New challan</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Entry only for now. Challan printing and the OTD dashboard arrive in Phase 3.
      </p>

      <div className="mt-6">
        <DataTable
          columns={dispatchColumns}
          data={dispatches}
          emptyMessage={
            canWrite ? "No dispatches yet. Enter the first challan." : "No dispatches yet."
          }
        />
      </div>
    </div>
  );
}
