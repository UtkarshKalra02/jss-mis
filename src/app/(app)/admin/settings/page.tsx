import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { AtRiskWindowForm } from "@/components/stages/settings-form";
import { getAtRiskWindowDays } from "@/modules/stages/queries";

export const metadata: Metadata = { title: "Settings · JSS MIS" };

export default async function AdminSettingsPage() {
  await requireAccess("admin", "write");

  const atRiskWindowDays = await getAtRiskWindowDays();

  return (
    <div>
      <Link href="/admin" className="text-muted-foreground text-[13px] hover:underline">
        ← Admin
      </Link>

      <h1 className="page-title mt-2">Settings</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Thresholds that would otherwise need a code change.
      </p>

      <section className="mt-6 rounded-lg border p-4">
        <AtRiskWindowForm current={atRiskWindowDays} />
      </section>

      <p className="text-muted-foreground mt-6 max-w-prose text-[13px]">
        This value is read by the database views themselves, not just by the app, so the
        dashboard, the item list and any report agree the moment it changes. There is no
        second copy of the number to keep in step.
      </p>
    </div>
  );
}
