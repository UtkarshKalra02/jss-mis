import type { Metadata } from "next";

import { requireAccess } from "@/auth/guard";
import { StageUpdateScreen } from "@/components/stage-update/stage-update-screen";
import { listAllStages, listItemsToUpdate } from "@/modules/stage-update/queries";

export const metadata: Metadata = { title: "Stage update · JSS MIS" };

/**
 * Spec 6.7. PLANNER on a laptop, FLOOR on a phone.
 *
 * This is Ajay's landing route — FLOOR has no dashboard, and this is the better
 * phone experience than one he could not act on anyway.
 */
export default async function StageUpdatePage() {
  await requireAccess("stage_update", "write");

  const [rows, stages] = await Promise.all([listItemsToUpdate(), listAllStages()]);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Stage update</h1>
        <span className="text-muted-foreground text-[13px] tabular-nums">
          {rows.length} open item{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Overdue first, then whatever is due soonest. Moving a job backwards is allowed — it
        is recorded as a new event, never by undoing the old one.
      </p>

      <div className="mt-6">
        <StageUpdateScreen rows={rows} stages={stages} />
      </div>
    </div>
  );
}
