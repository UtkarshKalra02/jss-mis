import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import {
  DesignActiveToggle,
  DesignApproval,
  DesignDelete,
} from "@/components/designs/design-controls";
import { DesignForm } from "@/components/designs/design-form";
import { DesignTooling } from "@/components/tooling/design-tooling";
import {
  getApproverName,
  getDesign,
  getDesignProcesses,
  listClientOptions,
  listRouteStages,
} from "@/modules/designs/queries";
import { designSelections, fabricationVocabulary } from "@/modules/fabrication/queries";
import { toolingForDesign } from "@/modules/tooling/queries";

export const metadata: Metadata = { title: "Design · JSS MIS" };

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("design");
  const canWrite = can(user.role, "design", "write");

  const { id } = await params;
  const design = await getDesign(id);
  if (!design) notFound();

  const [processes, clients, stages, approverName, tools, fabricationOptions, fabricationSelected] =
    await Promise.all([
      getDesignProcesses(id),
      listClientOptions(),
      listRouteStages(),
      getApproverName(design.approvedBy),
      toolingForDesign(id),
      fabricationVocabulary(),
      designSelections(id),
    ]);

  const canAddTooling = can(user.role, "tooling", "write");

  return (
    <div className="max-w-3xl">
      <Link href="/designs" className="text-muted-foreground text-[13px] hover:underline">
        ← Designs
      </Link>

      <div className="mt-2 flex items-baseline gap-3">
        <h1 className="page-title tabular-nums">{design.designCode}</h1>
        <span className="text-muted-foreground text-[13px]">{design.jobName}</span>
      </div>

      {/*
        The tooling attached to this design, with location and condition (I8).
        This is the screen Punit lives on, and it is the reason design.die_id
        and plate_id could be dropped: the answer they held badly is now
        derived from the register, where it is maintained properly and in
        exactly one place.

        Shown to readers as well as writers — knowing where the die is kept is
        not an editing privilege.
      */}
      <div className="mt-8">
        <DesignTooling tools={tools} canAdd={canAddTooling} />
      </div>

      {canWrite ? (
        <>
          <div className="mt-8">
            <DesignForm
              mode="edit"
              design={design}
              clients={clients}
              stages={stages}
              selectedProcesses={processes}
              fabricationOptions={fabricationOptions}
              fabricationSelected={fabricationSelected}
            />
          </div>

          <div className="mt-10 space-y-4">
            <DesignApproval
              designId={design.id}
              approvalStatus={design.approvalStatus}
              approvedAt={design.approvedAt}
              approverName={approverName}
            />
            <DesignActiveToggle
              designId={design.id}
              designCode={design.designCode}
              isActive={design.isActive}
            />
            <DesignDelete designId={design.id} designCode={design.designCode} />
          </div>
        </>
      ) : (
        <p className="text-muted-foreground mt-8 text-sm">
          Read-only. Ask the order desk to change a design.
        </p>
      )}
    </div>
  );
}
