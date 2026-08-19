import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { DispatchForm } from "@/components/dispatches/dispatch-form";
import { listClientOptions } from "@/modules/designs/queries";
import { listDispatchableItems } from "@/modules/dispatches/queries";

export const metadata: Metadata = { title: "New challan · JSS MIS" };

export default async function NewDispatchPage() {
  await requireAccess("dispatch", "write");

  const [clients, items] = await Promise.all([listClientOptions(), listDispatchableItems()]);

  return (
    <div>
      <Link href="/dispatch" className="text-muted-foreground text-[13px] hover:underline">
        ← Dispatch
      </Link>
      <h1 className="page-title mt-2">New challan</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Every item the client is still owed is listed, including ones that have not reached
        Ready — those are flagged rather than hidden, so a back-entered delivery can be
        recorded.
      </p>

      <div className="mt-8">
        <DispatchForm clients={clients} items={items} />
      </div>
    </div>
  );
}
