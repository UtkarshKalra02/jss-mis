/**
 * Moves design.die_id / plate_id into the tooling register.
 *
 *   npm run migrate:tooling              dry run — reports, writes NOTHING
 *   npm run migrate:tooling -- --apply   writes, in one transaction
 *
 * DRY RUN IS THE DEFAULT and `--apply` is the only way past it. This migration
 * runs once against live data and the columns it reads are dropped immediately
 * afterwards, so there is exactly one chance to get it right and no way to
 * re-read the source. Requiring a flag makes the write the deliberate act.
 *
 * The plan itself is a PURE FUNCTION in src/modules/tooling/migrate-from-design.ts,
 * so the report and the write compute the same thing from the same input — the
 * dry run is not a separate description of what the writer is believed to do.
 *
 * WHERE THIS SITS IN THE SEQUENCE (decision I7):
 *
 *   0014, 0015   create tooling and its client-derivation trigger
 *   THIS SCRIPT  move the data
 *   0016         drop design.die_id, plate_id, die_status, plate_status
 *
 * Migration 0016 refuses to run until this has been applied, so the order
 * cannot be got wrong by running db:migrate.
 *
 * Writes through the audit wrapper as the SYSTEM user (C4), so the rows it
 * creates carry a trail like every other write. Migration scripts DO audit —
 * otherwise the first real audit trail has a hole exactly where the historical
 * data arrived.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

// See seed-users.ts: a static import of src/db would hoist above config() and
// env validation would fail against an empty environment.
type DbModule = typeof import("../src/db");
type SchemaModule = typeof import("../src/db/schema");
type AuditModule = typeof import("../src/db/audit");
type NumberingModule = typeof import("../src/lib/numbering");
type PlanModule = typeof import("../src/modules/tooling/migrate-from-design");

async function main() {
  const apply = process.argv.includes("--apply");

  const { db }: DbModule = await import("../src/db");
  const { tooling }: SchemaModule = await import("../src/db/schema");
  const { auditedInsert, SYSTEM_ACTOR }: AuditModule = await import("../src/db/audit");
  const { allocateNumber }: NumberingModule = await import("../src/lib/numbering");
  const { planToolingMigration, renderPlan }: PlanModule = await import(
    "../src/modules/tooling/migrate-from-design"
  );
  const { sql } = await import("drizzle-orm");

  /*
   * READ BY RAW SQL, deliberately.
   *
   * These four columns are gone from src/db/schema/order.ts, because the code
   * that ships alongside migration 0016 must not reference them. This script
   * runs BEFORE that migration, against a database that still has them — it is
   * the one thing in the repository that reads a pre-0016 shape, so it reaches
   * past the schema rather than holding the schema back.
   *
   * The consequence is that this script stops working the moment 0016 has run,
   * which is correct: it has nothing left to do at that point, and the guard in
   * 0016 is what makes running it first unavoidable.
   */
  const result = await db.execute<{
    id: string;
    design_code: string;
    client_id: string;
    job_name: string;
    die_id: string | null;
    plate_id: string | null;
    die_status: string;
    plate_status: string;
  }>(sql`
    select id, design_code, client_id, job_name,
           die_id, plate_id, die_status::text, plate_status::text
    from design
    where deleted_at is null
    order by design_code
  `);

  const designs = result.rows.map((r) => ({
    id: r.id,
    designCode: r.design_code,
    clientId: r.client_id,
    jobName: r.job_name,
    dieId: r.die_id,
    plateId: r.plate_id,
    dieStatus: r.die_status,
    plateStatus: r.plate_status,
  }));

  const plan = planToolingMigration(designs);

  console.log(`\nRead ${designs.length} live design${designs.length === 1 ? "" : "s"}.\n`);
  console.log(renderPlan(plan));

  if (plan.tools.length === 0) {
    console.log("\nNothing to do.\n");
    process.exit(0);
  }

  if (!apply) {
    console.log(
      "\nDRY RUN — nothing was written.\n" +
        "Run it again with --apply to create these rows:\n" +
        "  npm run migrate:tooling -- --apply\n",
    );
    process.exit(0);
  }

  // ONE transaction. A half-migrated register is worse than an un-migrated
  // one: nobody knows how far it got, and migration 0016's guard would then
  // let the drop through with data still unmoved.
  const created = await db.transaction(async (tx) => {
    let n = 0;

    for (const tool of plan.tools) {
      await auditedInsert(
        SYSTEM_ACTOR,
        tooling,
        {
          toolNo: await allocateNumber(tx, tool.toolType === "DIE" ? "DIE" : "PLT"),
          toolType: tool.toolType,
          designId: tool.designId,
          clientId: tool.clientId,
          name: tool.name,
          location: tool.location,
          remarks: tool.remarks,
        },
        tx,
      );
      n += 1;
    }

    return n;
  });

  console.log(`\nCreated ${created} tooling row${created === 1 ? "" : "s"}.`);
  console.log(
    "Every one needs a location. Open the register, filter by the placeholder,\n" +
      "and fill them in from the shelf.\n\n" +
      "Migration 0016 will now let itself run:  npm run db:migrate\n",
  );

  process.exit(0);
}

main().catch((error) => {
  console.error("\nMigration failed. Nothing was written.\n");
  console.error(error);
  process.exit(1);
});
