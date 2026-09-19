import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { AdjustmentForm } from "@/components/materials/adjustment-form";
import { listAllBatches, listMaterialOptions } from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Adjust stock · JSS MIS" };

export default async function AdjustPage({
  searchParams,
}: {
  searchParams: Promise<{ material?: string }>;
}) {
  await requireAccess("material", "write");
  const { material } = await searchParams;
  const [materials, batches] = await Promise.all([listMaterialOptions(), listAllBatches()]);

  return (
    <div className="max-w-3xl">
      <Link href="/materials" className="text-muted-foreground text-[13px] hover:underline">
        ← Materials
      </Link>
      <h1 className="page-title mt-2">Adjust stock</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        When the shelf and the record disagree. Every correction is a row with a reason, never an
        edit of a count.
      </p>
      <div className="mt-8">
        <AdjustmentForm materials={materials} batches={batches} presetMaterialId={material} />
      </div>
    </div>
  );
}
