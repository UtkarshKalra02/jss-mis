import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { IssueForm, type IssuePreset } from "@/components/materials/issue-form";
import { getJobCard } from "@/modules/job-cards/queries";
import { paperCount } from "@/modules/job-cards/paper";
import type { PaperBundle } from "@/modules/job-cards/paper";
import { listDepartments, listMaterialOptions, listOpenBatches } from "@/modules/materials/queries";

export const metadata: Metadata = { title: "Issue material · JSS MIS" };

/**
 * Issue entry. With ?jobCard=… it arrives pre-filled from the card: the paper
 * the card names, and the parent-sheet count from paperCount() — J18's "what
 * left the godown" figure, reserved for exactly this (O3).
 */
export default async function IssuePage({
  searchParams,
}: {
  searchParams: Promise<{ material?: string; jobCard?: string }>;
}) {
  await requireAccess("material", "write");
  const { material, jobCard } = await searchParams;

  const [materials, batches, departments] = await Promise.all([
    listMaterialOptions(),
    listOpenBatches(),
    listDepartments(),
  ]);

  let preset: IssuePreset = { materialId: material };
  if (jobCard) {
    const card = await getJobCard(jobCard);
    if (card) {
      const sheets = paperCount({
        qty: card.paperQty,
        bundle: card.paperBundle as PaperBundle | null,
        parts: card.paperParts,
      });
      preset = {
        materialId: card.materialId ?? material,
        qty: sheets.parentSheets ? String(sheets.parentSheets) : undefined,
        jobCardId: card.id,
        jcNo: card.jcNo,
        department: "Offset Printing",
        // The job by name, so paper reserved for it under that name is
        // offered first (P3). The item's name is what the store calls the job.
        jobRef: card.itemName,
      };
    }
  }

  return (
    <div className="max-w-3xl">
      <Link href="/materials" className="text-muted-foreground text-[13px] hover:underline">
        ← Materials
      </Link>
      <h1 className="page-title mt-2">Issue material</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        From a batch to the floor. Oldest batch first unless you choose otherwise.
      </p>
      <div className="mt-8">
        <IssueForm materials={materials} batches={batches} departments={departments} preset={preset} />
      </div>
    </div>
  );
}
