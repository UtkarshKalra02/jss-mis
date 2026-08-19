import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { DesignForm } from "@/components/designs/design-form";
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
        <DesignForm mode="create" clients={clients} stages={stages} selectedProcesses={[]} />
      </div>
    </div>
  );
}
