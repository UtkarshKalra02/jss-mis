import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { IssueForm } from "@/components/materials/issue-form";
import { getJobCard } from "@/modules/job-cards/queries";
import { issuePresetFromCard, type IssuePreset } from "@/modules/materials/issue-preset";
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
    if (card) preset = issuePresetFromCard(card, material);
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
