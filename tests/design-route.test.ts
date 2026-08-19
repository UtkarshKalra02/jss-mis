import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { auditedInsert, auditedRestore, auditedSoftDelete, SYSTEM_ACTOR } from "@/db/audit";
import { designProcess } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * design_process carries a FULL unique constraint on (design_id, stage_code),
 * not the partial one used for natural keys elsewhere (C5). That is correct —
 * it is a junction row, not a natural key — but it has a consequence the write
 * path has to respect: a soft-deleted route row is still visible to the
 * constraint, so removing lamination from a design and adding it back later
 * cannot be an insert.
 *
 * These tests pin both halves: that the naive insert really does fail, and
 * that restoring is the way through. Without the first assertion the second
 * looks like unnecessary ceremony, and somebody simplifies it back into a bug.
 */

async function designFixture(tx: Tx) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("D")}, 'Design Co') returning id`,
    )
  ).rows as { id: string }[];

  const designCode = await allocateNumber(tx, "DSN");

  const [d] = (
    await tx.execute(
      sql`insert into design (design_code, client_id, job_name)
          values (${designCode}, ${c!.id}, 'Route test') returning id`,
    )
  ).rows as { id: string }[];

  return { designId: d!.id };
}

async function liveRoute(tx: Tx, designId: string): Promise<string[]> {
  const rows = await tx
    .select({ stageCode: designProcess.stageCode })
    .from(designProcess)
    .where(and(eq(designProcess.designId, designId), isNull(designProcess.deletedAt)));

  return rows.map((r) => r.stageCode).sort();
}

describe("design route", () => {
  it("refuses a plain re-insert of a removed process", async () => {
    await inRollback(async (tx) => {
      const f = await designFixture(tx);

      const row = await auditedInsert(
        SYSTEM_ACTOR,
        designProcess,
        { designId: f.designId, stageCode: "LAMINATION" },
        tx,
      );
      await auditedSoftDelete(SYSTEM_ACTOR, designProcess, row.id, tx);

      // The soft-deleted row is still there, and the full unique constraint
      // can still see it.
      const result = await expectFailure(tx, (sp) =>
        auditedInsert(
          SYSTEM_ACTOR,
          designProcess,
          { designId: f.designId, stageCode: "LAMINATION" },
          sp,
        ),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toContain("design_process_design_stage_key");
    });
  });

  it("restores the removed row instead, and the route reads correctly", async () => {
    await inRollback(async (tx) => {
      const f = await designFixture(tx);

      const row = await auditedInsert(
        SYSTEM_ACTOR,
        designProcess,
        { designId: f.designId, stageCode: "LAMINATION" },
        tx,
      );
      expect(await liveRoute(tx, f.designId)).toEqual(["LAMINATION"]);

      await auditedSoftDelete(SYSTEM_ACTOR, designProcess, row.id, tx);
      expect(await liveRoute(tx, f.designId)).toEqual([]);

      await auditedRestore(SYSTEM_ACTOR, designProcess, row.id, tx);
      expect(await liveRoute(tx, f.designId)).toEqual(["LAMINATION"]);
    });
  });

  it("refuses a route step that is not a real stage (non-negotiable 4)", async () => {
    await inRollback(async (tx) => {
      const f = await designFixture(tx);

      // The typo C1 was written to prevent. An array column would have taken
      // this quietly and under-counted a report months later.
      const result = await expectFailure(tx, (sp) =>
        auditedInsert(
          SYSTEM_ACTOR,
          designProcess,
          { designId: f.designId, stageCode: "LAMINATON" },
          sp,
        ),
      );

      expect(result.threw).toBe(true);
      expect(result.message).toMatch(/foreign key|stage/i);
    });
  });

  it("removes the route when the design is removed", async () => {
    await inRollback(async (tx) => {
      const f = await designFixture(tx);

      await auditedInsert(
        SYSTEM_ACTOR,
        designProcess,
        { designId: f.designId, stageCode: "UV" },
        tx,
      );

      const [row] = await tx
        .select({ id: designProcess.id })
        .from(designProcess)
        .where(eq(designProcess.designId, f.designId));

      await auditedSoftDelete(SYSTEM_ACTOR, designProcess, row!.id, tx);
      expect(await liveRoute(tx, f.designId)).toEqual([]);
    });
  });
});
