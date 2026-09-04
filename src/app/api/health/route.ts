import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { env } from "@/lib/env";

// bcrypt and the Neon driver both need Node APIs, so nothing here runs on the
// edge runtime. Stated explicitly rather than relied upon.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flattens an error and its `cause` chain.
 *
 * Drizzle wraps driver errors in its own "Failed query: …" Error and hangs the
 * original underneath as `cause`. Reporting only `.message` shows the SQL that
 * failed but not WHY, which made a WebSocket bundling fault look like a
 * database fault and cost a deploy cycle to work out.
 */
function errorChain(error: unknown): { name: string; message: string }[] {
  const chain: { name: string; message: string }[] = [];
  let current: unknown = error;
  while (current instanceof Error && chain.length < 5) {
    chain.push({ name: current.name, message: current.message });
    current = (current as { cause?: unknown }).cause;
  }
  if (chain.length === 0) chain.push({ name: "Unknown", message: String(error) });
  return chain;
}

/**
 * Detail is gated because this route is deliberately outside the middleware
 * matcher — it has to answer before anyone can sign in, which also means the
 * whole internet can call it.
 *
 * Database errors are chatty: the driver's message for a bad credential names
 * the database user. Fine in a terminal, not fine on a public URL. So the
 * public answer is just up or down, and the diagnosis needs the secret the
 * deployment already has:
 *
 *   curl -H "authorization: Bearer $AUTH_SECRET" https://…/api/health
 */
function isTrusted(request: NextRequest): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  const provided = header.slice(7);
  // Length check first so the comparison below cannot be used to probe length.
  return provided.length === env.AUTH_SECRET.length && provided === env.AUTH_SECRET;
}

/**
 * What the CODE currently expects the schema to contain.
 *
 * A deploy that ships ahead of its migrations is the single most confusing
 * failure this app has: the build is green, the tests pass, most screens work,
 * and one screen 500s because it selects a column that is not there yet. From
 * the outside it reads as "add design is broken" rather than as "production is
 * two migrations behind", and there is nothing on any screen to tell them
 * apart.
 *
 * Each entry names the migration that introduced it, so the answer to a failure
 * is the command to fix it rather than a puzzle.
 *
 * THIS LIST HAS TO BE EXTENDED WITH EVERY MIGRATION, and forgetting is worse
 * than never having had it. It stopped at 0009 while twelve more shipped, so
 * `schema.upToDate` reported TRUE against a production database missing five
 * of them — a confident all-clear on the one question somebody staring at
 * "Application error: a server-side exception has occurred" is trying to
 * answer. A check that is silently out of date is worse than no check.
 */
const SCHEMA_EXPECTATIONS: {
  what: string;
  sql: ReturnType<typeof sql>;
  since: string;
  /**
   * 'absent' inverts the check, for a migration that DROPS something.
   *
   * Without it a drop is invisible here: the query returns nothing whether the
   * migration ran or the table never existed, and the endpoint reports healthy
   * while the deployed code is selecting a column that is still there — or
   * worse, while a column the code no longer knows about is still being read
   * by something else.
   */
  expect?: "present" | "absent";
}[] = [
  {
    what: "po_item.committed_date is nullable",
    since: "0005_committed_date_nullable",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'po_item' and column_name = 'committed_date'
               and is_nullable = 'YES'`,
  },
  {
    what: "recompute_for_po_item()",
    since: "0006_po_status_recompute",
    sql: sql`select 1 from pg_proc where proname = 'recompute_for_po_item'`,
  },
  {
    what: "stage.is_process",
    since: "0007_stage_is_process",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'stage' and column_name = 'is_process'`,
  },
  {
    what: "dispatch_consumption_guard()",
    since: "0008_draft_does_not_consume",
    sql: sql`select 1 from pg_proc where proname = 'dispatch_consumption_guard'`,
  },
  {
    what: "import_batch",
    since: "0009_import_batch",
    sql: sql`select 1 from information_schema.tables where table_name = 'import_batch'`,
  },
  {
    what: "client.import_batch_id",
    since: "0010_client_created_by_import",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'client' and column_name = 'import_batch_id'`,
  },
  {
    what: "delegation_task",
    since: "0011_delegation_task",
    sql: sql`select 1 from information_schema.tables where table_name = 'delegation_task'`,
  },
  {
    what: "v_delegation_scorecard",
    since: "0012_delegation_views",
    sql: sql`select 1 from information_schema.views where table_name = 'v_delegation_scorecard'`,
  },
  {
    what: "press_run",
    since: "0013_press_run",
    sql: sql`select 1 from information_schema.tables where table_name = 'press_run'`,
  },
  {
    what: "tooling",
    since: "0014_tooling",
    sql: sql`select 1 from information_schema.tables where table_name = 'tooling'`,
  },
  {
    what: "tooling_derive_client()",
    since: "0015_tooling_client_trigger",
    sql: sql`select 1 from pg_proc where proname = 'tooling_derive_client'`,
  },
  {
    what: "design.die_id is gone",
    since: "0016_drop_design_die_plate",
    expect: "absent",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'design' and column_name = 'die_id'`,
  },
  {
    what: "job_card.paper_supply_by",
    since: "0017_job_card_execution",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card' and column_name = 'paper_supply_by'`,
  },
  {
    what: "tooling.pantone_no",
    since: "0018_tooling_ink_pantone",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'tooling' and column_name = 'pantone_no'`,
  },
  {
    what: "fabrication_option",
    since: "0019_fabrication_vocabulary",
    sql: sql`select 1 from information_schema.tables where table_name = 'fabrication_option'`,
  },
  {
    what: "job_card.paper_size and the machine list",
    since: "0020_job_card_manual_fields",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card' and column_name = 'paper_size'`,
  },
  {
    what: "job_card.machine_detail is gone",
    since: "0021_drop_job_card_machine_detail",
    expect: "absent",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card' and column_name = 'machine_detail'`,
  },
  {
    what: "tool_status includes 'Ordered'",
    since: "0022_tool_status_ordered",
    sql: sql`select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'tool_status' and e.enumlabel = 'Ordered'`,
  },
  {
    what: "tooling.location is nullable",
    since: "0023_tooling_location_optional_when_ordered",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'tooling' and column_name = 'location'
               and is_nullable = 'YES'`,
  },
  {
    what: "press_run carries the shared sheet",
    since: "0024_press_run_shared_sheet",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'press_run' and column_name = 'paper_size'`,
  },
  {
    what: "job_card.sheets_per_ream and exec_size are gone",
    since: "0026_drop_sheets_per_ream_and_exec_size",
    expect: "absent",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card' and column_name in ('sheets_per_ream', 'exec_size')`,
  },
  {
    what: "job_card.paper_bundle and exec_pantone",
    since: "0027_paper_bundle_and_pantone",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card' and column_name = 'paper_bundle'`,
  },
  {
    what: "press_run.paper_bundle",
    since: "0027_paper_bundle_and_pantone",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'press_run' and column_name = 'paper_bundle'`,
  },
];

async function checkSchema() {
  const missing: { what: string; since: string }[] = [];

  for (const check of SCHEMA_EXPECTATIONS) {
    const wantPresent = (check.expect ?? "present") === "present";
    try {
      const result = await db.execute(check.sql);
      const found = result.rows.length > 0;
      if (found !== wantPresent) missing.push({ what: check.what, since: check.since });
    } catch {
      missing.push({ what: check.what, since: check.since });
    }
  }

  return missing;
}

/**
 * Liveness probe, and the first thing to check after a deploy.
 *
 * `nativeWebSocket` is the field worth reading: when it is false the Neon
 * driver has fallen back to the bundled `ws` package, which is the exact
 * configuration that produced `b.mask is not a function` in production.
 *
 * `schema.upToDate` is the second: false means this database is behind the
 * code that is talking to it.
 */
export async function GET(request: NextRequest) {
  const trusted = isTrusted(request);

  const runtimeInfo = {
    node: process.version,
    nativeWebSocket: typeof globalThis.WebSocket === "function",
    region: process.env.VERCEL_REGION ?? "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  };

  try {
    const result = await db.execute<{
      now: string;
      database: string;
      ist_now: string;
    }>(sql`
      select
        now()                                        as now,
        current_database()                           as database,
        to_char(now() at time zone 'Asia/Kolkata',
                'YYYY-MM-DD HH24:MI:SS')             as ist_now
    `);

    // Which migrations this database is missing is not a secret — it is a
    // statement about our own deploy, names no credential, and is the first
    // thing anybody needs after pushing.
    const missing = await checkSchema();

    // The success case carries no secrets, so it stays public — `ist_now` in
    // particular needs to be checkable without ceremony after every deploy.
    return NextResponse.json({
      ok: missing.length === 0,
      ...result.rows[0],
      runtime: runtimeInfo,
      schema:
        missing.length === 0
          ? { upToDate: true }
          : {
              upToDate: false,
              missing,
              hint: "Run `npm run db:migrate` against this database. Screens that use these will 500 until you do.",
            },
    });
  } catch (error) {
    if (!trusted) {
      return NextResponse.json(
        {
          ok: false,
          error: "Database unreachable.",
          hint: "Re-run with: curl -H 'authorization: Bearer <AUTH_SECRET>' <url>",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: false, errors: errorChain(error), runtime: runtimeInfo },
      { status: 500 },
    );
  }
}
