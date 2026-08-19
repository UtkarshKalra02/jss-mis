import { and, asc, count, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { appUser, client, design, designProcess, stage } from "@/db/schema";

export type DesignRow = {
  id: string;
  designCode: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  jobName: string;
  jobSize: string | null;
  paperType: string | null;
  gsm: string | null;
  dieStatus: string;
  plateStatus: string;
  approvalStatus: string;
  processCount: number;
  isActive: boolean;
};

/**
 * The grid. Live designs only — soft-deleted rows never appear
 * (non-negotiable 7).
 *
 * The client is joined rather than looked up per row: the grid shows a client
 * name on every line, and "which design is this?" is almost always asked as
 * "which of NAT's designs is this?".
 */
export async function listDesigns(): Promise<DesignRow[]> {
  const processCounts = db
    .select({
      designId: designProcess.designId,
      n: count().as("n"),
    })
    .from(designProcess)
    .where(isNull(designProcess.deletedAt))
    .groupBy(designProcess.designId)
    .as("process_counts");

  return db
    .select({
      id: design.id,
      designCode: design.designCode,
      clientId: design.clientId,
      clientCode: client.code,
      clientName: client.name,
      jobName: design.jobName,
      jobSize: design.jobSize,
      paperType: design.paperType,
      gsm: design.gsm,
      dieStatus: design.dieStatus,
      plateStatus: design.plateStatus,
      approvalStatus: design.approvalStatus,
      processCount: sql<number>`coalesce(${processCounts.n}, 0)::int`,
      isActive: design.isActive,
    })
    .from(design)
    .innerJoin(client, eq(client.id, design.clientId))
    .leftJoin(processCounts, eq(processCounts.designId, design.id))
    .where(isNull(design.deletedAt))
    .orderBy(asc(design.designCode));
}

export async function getDesign(id: string) {
  const [row] = await db
    .select()
    .from(design)
    .where(and(eq(design.id, id), isNull(design.deletedAt)))
    .limit(1);

  return row ?? null;
}

/** The stage codes on a design's route. Live rows only. */
export async function getDesignProcesses(designId: string): Promise<string[]> {
  const rows = await db
    .select({ stageCode: designProcess.stageCode })
    .from(designProcess)
    .innerJoin(stage, eq(stage.code, designProcess.stageCode))
    .where(and(eq(designProcess.designId, designId), isNull(designProcess.deletedAt)))
    .orderBy(asc(stage.sequence));

  return rows.map((r) => r.stageCode);
}

export type RouteStage = {
  code: string;
  name: string;
  sequence: number;
  isOptional: boolean;
  colour: string;
};

/**
 * The stages a design's route may be built from.
 *
 * Read from the `stage` table, in sequence order — never a list in a component
 * (non-negotiable 5). A stage ADMIN adds appears here immediately, and one
 * that is deactivated stops being offered without breaking the designs that
 * already reference it, because `design_process` keeps its foreign key.
 */
export async function listRouteStages(): Promise<RouteStage[]> {
  return db
    .select({
      code: stage.code,
      name: stage.name,
      sequence: stage.sequence,
      isOptional: stage.isOptional,
      colour: stage.colour,
    })
    .from(stage)
    .where(and(isNull(stage.deletedAt), eq(stage.isActive, true)))
    .orderBy(asc(stage.sequence));
}

export type ClientOption = { id: string; code: string; name: string; isActive: boolean };

/**
 * Clients for the picker. Inactive ones are included but flagged, so editing a
 * design whose client was deactivated does not silently drop the selection.
 */
export async function listClientOptions(): Promise<ClientOption[]> {
  return db
    .select({
      id: client.id,
      code: client.code,
      name: client.name,
      isActive: client.isActive,
    })
    .from(client)
    .where(isNull(client.deletedAt))
    .orderBy(asc(client.name));
}

/**
 * The approver's name, for the detail screen.
 *
 * Read live rather than stored alongside the approval, because a name is
 * presentation and app_user is where it belongs. Usernames are immutable (E11)
 * so this cannot silently rewrite who approved something.
 */
export async function getApproverName(userId: string | null): Promise<string | null> {
  if (!userId) return null;

  const [row] = await db
    .select({ name: appUser.name })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);

  return row?.name ?? null;
}
