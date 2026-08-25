import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import {
  ClientActiveToggle,
  ImportedClientCard,
  RemoveClientCard,
} from "@/components/clients/client-controls";
import { ClientForm } from "@/components/clients/client-form";
import { formatINR } from "@/lib/format";
import { getClient } from "@/modules/clients/queries";

export const metadata: Metadata = { title: "Client · JSS MIS" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("client");
  const canWrite = can(user.role, "client", "write");

  const { id } = await params;
  const record = await getClient(id);
  if (!record) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/clients" className="text-muted-foreground text-[13px] hover:underline">
        ← Clients
      </Link>

      <h1 className="page-title mt-2">{record.name}</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        {record.code} · {record.clientType} · {record.isActive ? "Active" : "Inactive"} ·{" "}
        {record.paymentTermsDays} day terms
        {record.creditLimit ? ` · limit ${formatINR(record.creditLimit)}` : ""}
      </p>

      {!record.isActive ? (
        <p className="bg-neutral-status-bg text-muted-foreground mt-4 rounded-md px-3 py-2 text-[13px]">
          This client is inactive and cannot be chosen for new orders. Existing history is
          unaffected.
        </p>
      ) : null}

      {canWrite ? (
        <div className="mt-8 space-y-6">
          {record.importBatchId && !record.importReviewedAt ? (
            <ImportedClientCard clientId={record.id} clientName={record.name} />
          ) : null}

          <section className="rounded-lg border p-4">
            <ClientForm mode="edit" client={record} />
          </section>

          <ClientActiveToggle
            clientId={record.id}
            clientName={record.name}
            isActive={record.isActive}
          />

          <RemoveClientCard clientId={record.id} clientName={record.name} />
        </div>
      ) : (
        <dl className="mt-8 grid gap-x-8 gap-y-3 rounded-lg border p-4 text-[13px] sm:grid-cols-2">
          {[
            ["GSTIN", record.gstin],
            ["Address", [record.addressLine1, record.addressLine2].filter(Boolean).join(", ")],
            ["City", record.city],
            ["State", record.state],
            ["Pincode", record.pincode],
            ["Contact", record.contactName],
            ["Phone", record.contactPhone],
            ["Email", record.contactEmail],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd>{value || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
