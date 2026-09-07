import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { appUser, client, design } from "@/db/schema";

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
  approvalStatus: string;
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
      approvalStatus: design.approvalStatus,
      isActive: design.isActive,
    })
    .from(design)
    .innerJoin(client, eq(client.id, design.clientId))
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
