import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { StageConfigForm } from "@/components/stages/stage-config-form";
import { listStages } from "@/modules/stages/queries";

export const metadata: Metadata = { title: "Stages · JSS MIS" };

export default async function AdminStagesPage() {
  await requireAccess("admin", "write");

  const stages = await listStages();
  const unverified = stages.filter((s) => !s.targetHoursVerified).length;

  return (
    <div>
      <Link href="/admin" className="text-muted-foreground text-[13px] hover:underline">
        ← Admin
      </Link>

      <h1 className="page-title mt-2">Stages</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        The production stages an item moves through. Codes cannot be changed — the stage
        history of every item references them.
      </p>

      {/* Decision A2: the seeded target hours are placeholders from an example
          workbook and were never measured. They feed the WIP-ageing "over
          target" flag, so the screen has to say so until a human fixes them. */}
      {unverified > 0 ? (
        <div className="bg-at-risk-bg mt-5 rounded-md px-4 py-3">
          <p className="text-at-risk text-[13px] font-medium">
            {unverified} of {stages.length} target hours are unverified.
          </p>
          <p className="text-muted-foreground mt-1 text-[13px]">
            They were copied from an example workbook and have never been measured on the
            floor, but they still drive the &ldquo;sitting too long&rdquo; flag in WIP
            ageing. Enter a real figure and the row marks itself measured; untick it again
            if the new number is still an estimate.
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        <StageConfigForm stages={stages} />
      </div>

      <div className="text-muted-foreground mt-6 max-w-prose space-y-2 text-[13px]">
        <p>
          <strong className="text-foreground font-medium">Sequence</strong> is numbered in
          tens so a new stage can be slotted between two existing ones without renumbering
          the table.
        </p>
        <p>
          <strong className="text-foreground font-medium">Applies to</strong> describes the
          job, not the client. A long-standing client still places genuinely new jobs, and
          those go through Enquiry and Costing.
        </p>
        <p>
          <strong className="text-foreground font-medium">Target hours</strong> flags work
          that has sat in one stage too long. It is a separate signal from the dashboard
          at-risk list, which is based on the committed date.
        </p>
      </div>
    </div>
  );
}
