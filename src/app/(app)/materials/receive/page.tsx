import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { GrnForm } from "@/components/materials/grn-form";
import { listMaterialOptions } from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Receive material · JSS MIS" };

export default async function ReceivePage({
  searchParams,
}: {
  searchParams: Promise<{ material?: string }>;
}) {
  await requireAccess("material", "write");
  const { material } = await searchParams;
  const materials = await listMaterialOptions();

  return (
    <div className="max-w-4xl">
      <Link href="/materials" className="text-muted-foreground text-[13px] hover:underline">
        ← Materials
      </Link>
      <h1 className="page-title mt-2">Receive material</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        One vendor document per receipt. Every line becomes a batch that issues draw from.
      </p>
      <div className="mt-8">
        <GrnForm materials={materials} presetMaterialId={material} />
      </div>
    </div>
  );
}
