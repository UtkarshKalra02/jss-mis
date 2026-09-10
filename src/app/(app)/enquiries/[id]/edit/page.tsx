import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { EnquiryForm } from "@/components/enquiries/enquiry-form";
import { listClientOptions } from "@/modules/designs/queries";
import { getEnquiry, listOwnerOptions, listSourceOptions } from "@/modules/enquiries/queries";
import { canAssignEnquiryOwner } from "@/modules/enquiries/permissions";

export const metadata: Metadata = { title: "Edit enquiry · JSS MIS" };

export default async function EditEnquiryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("enquiry", "write");

  const { id } = await params;
  const [enquiry, clients, sources, owners] = await Promise.all([
    getEnquiry(id),
    listClientOptions(),
    listSourceOptions(),
    listOwnerOptions(),
  ]);

  if (!enquiry) notFound();

  return (
    <div>
      <Link
        href={`/enquiries/${enquiry.id}`}
        className="text-muted-foreground text-[13px] hover:underline"
      >
        ← {enquiry.enquiryNo}
      </Link>
      <h1 className="page-title mt-2">Edit enquiry</h1>

      <div className="mt-8">
        <EnquiryForm
          clients={clients}
          sources={sources}
          owners={owners}
          defaultOwnerId={user.id}
          canAssign={canAssignEnquiryOwner(user.role)}
          canCreateClient={can(user.role, "client", "write")}
          enquiry={enquiry}
        />
      </div>
    </div>
  );
}
