import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { ClientForm } from "@/components/clients/client-form";

export const metadata: Metadata = { title: "Add client · JSS MIS" };

export default async function NewClientPage() {
  await requireAccess("client", "write");

  return (
    <div className="max-w-3xl">
      <Link href="/clients" className="text-muted-foreground text-[13px] hover:underline">
        ← Clients
      </Link>

      <h1 className="page-title mt-2">Add client</h1>
      <p className="text-muted-foreground mt-1 mb-8 text-[13px]">
        Only the code and name are required. The rest can be filled in later — a PO often
        arrives before the paperwork does.
      </p>

      <ClientForm mode="create" />
    </div>
  );
}
