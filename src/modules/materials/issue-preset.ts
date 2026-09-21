import { paperCount, type PaperBundle } from "@/modules/job-cards/paper";

/** What the issue form is handed when it opens from a job card (O3). */
export type IssuePreset = {
  materialId?: string;
  qty?: string;
  jobCardId?: string;
  jcNo?: string;
  department?: string;
  /** The job by name, to match paper reserved for it (P3). */
  jobRef?: string;
};

export type IssueCard = {
  id: string;
  jcNo: string;
  itemName: string;
  materialId: string | null;
  paperQty: number | null;
  paperBundle: string | null;
  paperParts: number | null;
};

/**
 * The store deducts PARENT sheets. A card for five packets cut into four
 * parts is 500 sheets leaving the godown, not 2,000 press sheets — the cut
 * happens after the paper has been issued. `paperCount()` derives both
 * figures; this is the one place that chooses between them for the store,
 * and tests/issue-preset.test.ts pins the choice.
 */
export function issuePresetFromCard(card: IssueCard, fallbackMaterialId?: string): IssuePreset {
  const sheets = paperCount({
    qty: card.paperQty,
    bundle: card.paperBundle as PaperBundle | null,
    parts: card.paperParts,
  });
  return {
    materialId: card.materialId ?? fallbackMaterialId,
    qty: sheets.parentSheets ? String(sheets.parentSheets) : undefined,
    jobCardId: card.id,
    jcNo: card.jcNo,
    department: "Offset Printing",
    // The job by name, so paper reserved for it under that name is offered
    // first (P3). The item's name is what the store calls the job.
    jobRef: card.itemName,
  };
}
