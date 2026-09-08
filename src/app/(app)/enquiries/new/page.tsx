import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { EnquiryForm } from "@/components/enquiries/enquiry-form";
import { listClientOptions } from "@/modules/designs/queries";
import { listOwnerOptions, listSourceOptions } from "@/modules/enquiries/queries";

export const metadata: Metadata = { title: "New enquiry · JSS MIS" };

export default async function NewEnquiryPage() {
  const user = await requireAccess("enquiry", "write");

  const [clients, sources, owners] = await Promise.all([
    listClientOptions(),
    listSourceOptions(),
    listOwnerOptions(),
  ]);

  return (
    <div>
      <Link href="/enquiries" className="text-muted-foreground text-[13px] hover:underline">
        ← Enquiries
      </Link>
      <h1 className="page-title mt-2">New enquiry</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Record it while the call is still fresh. An enquiry that never becomes a job is
        still worth having — the win rate is meaningless without the ones that got away.
      </p>

      <div className="mt-8">
        <EnquiryForm
          clients={clients}
          sources={sources}
          owners={owners}
          defaultOwnerId={user.id}
        />
      </div>
    </div>
  );
}
