import { and, asc, eq, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import type { Tx } from "@/db/audit";
import { client, design, tooling } from "@/db/schema";

/**
 * Reads for the Job Kitting register.
 *
 * The query this file exists for is "where is the die for X". Everything is
 * shaped around answering that from a phone in one search box, so the search
 * spans tool number, name, client, design and LOCATION itself — somebody
 * standing at a rack asks the register what is supposed to be in it.
 */

type Runner = typeof db | Tx;

export type ToolingRow = {
  id: string;
  toolNo: string;
  toolType: string;
  name: string;
  size: string | null;
  colour: string | null;
  ink: string | null;
  pantoneNo: string | null;
  location: string;
  condition: string;
  status: string;
  clientId: string | null;
  clientCode: string | null;
  clientName: string | null;
  designId: string | null;
  designCode: string | null;
  designJobName: string | null;
};

const LIVE = isNull(tooling.deletedAt);

/** The columns every list view needs, joined to the names people search by. */
function selectRow() {
  return {
    id: tooling.id,
    toolNo: tooling.toolNo,
    toolType: tooling.toolType,
    name: tooling.name,
    size: tooling.size,
    colour: tooling.colour,
    ink: tooling.ink,
    pantoneNo: tooling.pantoneNo,
    location: tooling.location,
    condition: tooling.condition,
    status: tooling.status,
    clientId: client.id,
    clientCode: client.code,
    clientName: client.name,
    designId: design.id,
    designCode: design.designCode,
    designJobName: design.jobName,
  };
}

export type ToolingFilters = {
  query?: string;
  toolType?: string;
  condition?: string;
  status?: string;
};

/**
 * The register grid.
 *
 * ONE search box across five fields rather than five boxes, on the same
 * reasoning as the Item Tracker (F24): somebody asked "where is the Fertilina
 * die?" has a fragment, not a field name, and frequently does not know whether
 * the number they were given is the tool's or the design's.
 *
 * LOCATION is one of the searchable fields, which the item tracker has no
 * equivalent of. "What is in almirah 2" is a real question and the answer is a
 * list, not a lookup.
 *
 * Filters are separate from the query because they are a different kind of
 * question — "show me everything Damaged" is a browse, not a search, and mixing
 * them into one box would make "Damaged" match a tool whose remarks mention it.
 */
export async function searchTooling(
  filters: ToolingFilters = {},
  runner: Runner = db,
): Promise<ToolingRow[]> {
  const conditions: SQL[] = [LIVE];

  const q = filters.query?.trim();
  if (q) {
    const like = `%${q}%`;
    const match = or(
      sql`${tooling.toolNo} ilike ${like}`,
      sql`${tooling.name} ilike ${like}`,
      sql`${tooling.location} ilike ${like}`,
      sql`${client.name} ilike ${like}`,
      sql`${client.code} ilike ${like}`,
      sql`${design.designCode} ilike ${like}`,
      sql`${design.jobName} ilike ${like}`,
      /*
       * Pantone is searchable; ink is not.
       *
       * A Pantone reference is an IDENTIFIER — somebody holding a job sheet
       * that says 485 C wants the plate that carries it, which is the same
       * kind of lookup as a tool number. Ink is a description, and folding
       * descriptions into the box is what makes "Damaged" match a tool whose
       * remarks merely mention the word.
       */
      sql`${tooling.pantoneNo} ilike ${like}`,
    );
    if (match) conditions.push(match);
  }

  // Compared as text so an unknown value from the URL simply matches nothing,
  // rather than throwing an enum cast error on a hand-edited query string.
  if (filters.toolType) conditions.push(sql`${tooling.toolType}::text = ${filters.toolType}`);
  if (filters.condition) conditions.push(sql`${tooling.condition}::text = ${filters.condition}`);
  if (filters.status) conditions.push(sql`${tooling.status}::text = ${filters.status}`);

  return runner
    .select(selectRow())
    .from(tooling)
    .leftJoin(design, eq(design.id, tooling.designId))
    .leftJoin(client, eq(client.id, tooling.clientId))
    .where(and(...conditions))
    .orderBy(asc(tooling.location), asc(tooling.name));
}

export async function getTooling(id: string, runner: Runner = db): Promise<ToolingRow | null> {
  const [row] = await runner
    .select(selectRow())
    .from(tooling)
    .leftJoin(design, eq(design.id, tooling.designId))
    .leftJoin(client, eq(client.id, tooling.clientId))
    .where(and(eq(tooling.id, id), LIVE))
    .limit(1);

  return row ?? null;
}

/** The full row, for actions that check before writing. */
export async function getToolingRecord(id: string, runner: Runner = db) {
  const [row] = await runner
    .select()
    .from(tooling)
    .where(and(eq(tooling.id, id), LIVE))
    .limit(1);

  return row ?? null;
}

/**
 * Tooling attached to one design, with the two fields Punit reads (I8).
 *
 * This is the screen he will actually live on, so location and condition come
 * back with the row rather than needing the register to be opened.
 */
export async function toolingForDesign(
  designId: string,
  runner: Runner = db,
): Promise<ToolingRow[]> {
  return runner
    .select(selectRow())
    .from(tooling)
    .leftJoin(design, eq(design.id, tooling.designId))
    .leftJoin(client, eq(client.id, tooling.clientId))
    .where(and(eq(tooling.designId, designId), LIVE))
    .orderBy(asc(tooling.toolType), asc(tooling.name));
}

export type ChainLink = { id: string; toolNo: string; name: string; condition: string };

/**
 * The replacement chain, in both directions.
 *
 * Walked in TypeScript with a visited set rather than as a recursive CTE, for
 * two reasons. It is far easier to read a year from now, which is the standing
 * trade in this codebase; and the visited set makes a cycle impossible to loop
 * on, where a recursive query needs its own guard. The chains are two or three
 * links long in practice, so the extra round trips cost nothing.
 *
 * `replaces` reads backwards in time — what this tool superseded, then what
 * THAT one superseded. `replacedBy` reads forwards.
 */
export async function replacementChain(
  id: string,
  runner: Runner = db,
): Promise<{ replaces: ChainLink[]; replacedBy: ChainLink[] }> {
  const MAX_HOPS = 20;

  const link = (row: {
    id: string;
    toolNo: string;
    name: string;
    condition: string;
  }): ChainLink => ({ id: row.id, toolNo: row.toolNo, name: row.name, condition: row.condition });

  const cols = {
    id: tooling.id,
    toolNo: tooling.toolNo,
    name: tooling.name,
    condition: tooling.condition,
    replacesToolId: tooling.replacesToolId,
  };

  const seen = new Set<string>([id]);

  // Backwards: follow replaces_tool_id until it runs out.
  const replaces: ChainLink[] = [];
  let cursor: string | null =
    (await runner.select(cols).from(tooling).where(and(eq(tooling.id, id), LIVE)).limit(1))[0]
      ?.replacesToolId ?? null;

  while (cursor && !seen.has(cursor) && replaces.length < MAX_HOPS) {
    seen.add(cursor);
    const [row] = await runner
      .select(cols)
      .from(tooling)
      .where(and(eq(tooling.id, cursor), LIVE))
      .limit(1);
    if (!row) break;
    replaces.push(link(row));
    cursor = row.replacesToolId;
  }

  // Forwards: who points AT this one, and who points at them.
  const replacedBy: ChainLink[] = [];
  let target: string | null = id;

  while (target && replacedBy.length < MAX_HOPS) {
    const [row] = await runner
      .select(cols)
      .from(tooling)
      .where(and(eq(tooling.replacesToolId, target), LIVE))
      .limit(1);

    if (!row || seen.has(row.id)) break;
    seen.add(row.id);
    replacedBy.push(link(row));
    target = row.id;
  }

  return { replaces, replacedBy };
}

/** Tools offerable as "this replaces…". Excludes the tool itself. */
export async function replaceableTools(
  excludeId: string | null,
  runner: Runner = db,
): Promise<{ id: string; toolNo: string; name: string }[]> {
  const rows = await runner
    .select({ id: tooling.id, toolNo: tooling.toolNo, name: tooling.name })
    .from(tooling)
    .where(LIVE)
    .orderBy(asc(tooling.toolNo));

  return excludeId ? rows.filter((r) => r.id !== excludeId) : rows;
}

/** Designs to attach tooling to. */
export async function designOptions(runner: Runner = db) {
  return runner
    .select({
      id: design.id,
      designCode: design.designCode,
      jobName: design.jobName,
      clientName: client.name,
    })
    .from(design)
    .innerJoin(client, eq(client.id, design.clientId))
    .where(isNull(design.deletedAt))
    .orderBy(asc(design.designCode));
}

/** Clients, for tooling with no design against it. */
export async function clientOptions(runner: Runner = db) {
  return runner
    .select({ id: client.id, code: client.code, name: client.name })
    .from(client)
    .where(isNull(client.deletedAt))
    .orderBy(asc(client.name));
}
