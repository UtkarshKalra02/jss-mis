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
    // 0008 added this; 0035 dropped it again (K12). Checking for its absence
    // is what proves 0035 ran — checking for its presence, which this did
    // until 15 Sep 2026, reported a correct database as behind, and said
    // nothing about the two migrations that actually were missing.
    what: "dispatch_consumption_guard() gone",
    since: "0035_over_delivery_allowed",
    expect: "absent",
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
  {
    what: "design_process is gone",
    since: "0028_drop_design_process",
    expect: "absent",
    sql: sql`select 1 from information_schema.tables where table_name = 'design_process'`,
  },
  {
    what: "material reorder columns (v_material_stock.stock_status)",
    since: "0040_material_reorder_from_ledger",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'v_material_stock' and column_name = 'stock_status'`,
  },
  {
    what: "material stock: tables, views, issue guard, DATA_ENTRY",
    since: "0039_material_stock",
    sql: sql`select 1 from pg_trigger where tgname = 'material_issue_guard_trg'`,
  },
  {
    what: "v_po_item_status.po_awaited, and the item-move guard",
    since: "0038_po_item_moves_between_orders",
    sql: sql`select 1 from pg_trigger where tgname = 'po_item_move_guard_trg'`,
  },
  {
    what: "plan_entry",
    since: "0037_plan_entry",
    sql: sql`select 1 from information_schema.tables where table_name = 'plan_entry'`,
  },
  {
    what: "stage.name_hi",
    since: "0036_stage_hindi_name",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'stage' and column_name = 'name_hi'`,
  },
  {
    what: "delegation refuses an owner assignee",
    since: "0032_no_delegation_to_owner",
    sql: sql`select 1 from pg_trigger
             where tgname = 'delegation_task_no_owner_assignee_trg'`,
  },
  {
    what: "job_card_item, and job_card.po_item_id gone",
    since: "0031_job_card_covers_many_items",
    sql: sql`select 1 from information_schema.tables where table_name = 'job_card_item'`,
  },
  {
    what: "job_card_fabrication.applies",
    since: "0030_job_card_fabrication_applies",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card_fabrication' and column_name = 'applies'`,
  },
  {
    // Seed data rather than schema, and worth checking for the same reason:
    // a database missing it renders a job card that quietly omits a line the
    // paper one has.
    what: "the BINDING fabrication option",
    since: "0029_binding_vocabulary",
    sql: sql`select 1 from fabrication_option
             where code = 'BINDING' and deleted_at is null`,
  },

  // ---------------------------------------------------------------------
  // 0041 onwards. The list stopped at 0040 while eleven migrations shipped —
  // the exact failure the header above warns about, for the second time.
  // Newest first from here down.
  // ---------------------------------------------------------------------
  {
    // The FUNCTION rather than the tables: petty_cash without
    // petty_cash_balance_on() is the dangerous half-state, because every
    // balance on the screen reads it and the tables alone would render a sheet
    // with no arithmetic.
    what: "petty_cash_balance_on(), the tin's one definition of a balance",
    since: "0052_petty_cash",
    sql: sql`select 1 from pg_proc where proname = 'petty_cash_balance_on'`,
  },
  {
    what: "v_po_item_status.closed_manually_at (OTD can see a manual close)",
    since: "0051_otd_sees_manual_close",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'v_po_item_status'
               and column_name = 'closed_manually_at'`,
  },
  {
    what: "purchase_order.is_job_work",
    since: "0050_job_work",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'purchase_order' and column_name = 'is_job_work'`,
  },
  {
    what: "job_card.ups",
    since: "0049_job_card_ups",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card' and column_name = 'ups'`,
  },
  {
    // The trigger rather than the column: the columns without the trigger is
    // the dangerous half-state, because the close would be writable with no
    // fence on how old the PO has to be.
    what: "manual job close, fence and recompute",
    since: "0048_manual_job_close",
    sql: sql`select 1 from pg_trigger
             where tgname = 'po_item_manual_close_recompute_trg'`,
  },
  {
    what: "v_job_opening and working_minutes_between()",
    since: "0047_job_opening_discipline",
    sql: sql`select 1 from pg_proc where proname = 'working_minutes_between'`,
  },
  {
    // 0045 added this check; 0046 rewrote it to be null-safe. Checking that
    // the constraint EXISTS cannot tell the two apart, and the difference is
    // the whole of 0046 — so the check reads the constraint's own text.
    what: "material_batch_bundles_agree is null-safe",
    since: "0046_bundles_pair_null_safe",
    sql: sql`select 1 from pg_constraint
             where conname = 'material_batch_bundles_agree'
               and pg_get_constraintdef(oid) like '%IS NULL%'`,
  },
  {
    what: "job_card.paper_sheets_per_bundle",
    since: "0045_bundle_size_columns",
    sql: sql`select 1 from information_schema.columns
             where table_name = 'job_card'
               and column_name = 'paper_sheets_per_bundle'`,
  },
  {
    what: "the 'Bundle' paper_bundle option",
    since: "0044_manual_bundle_size",
    sql: sql`select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'paper_bundle' and e.enumlabel = 'Bundle'`,
  },
  {
    what: "auto_close_pending_below",
    since: "0043_auto_close_small_residuals",
    sql: sql`select 1 from app_setting where key = 'auto_close_pending_below'`,
  },
  {
    what: "the DATA_ENTRY_FULL role",
    since: "0042_data_entry_full_role",
    sql: sql`select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'user_role' and e.enumlabel = 'DATA_ENTRY_FULL'`,
  },
  {
    // Seed data, checked for the same reason as BINDING above: a database
    // missing these renders a stage list that is quietly three short.
    what: "the three finishing stages",
    since: "0041_three_finishing_stages",
    sql: sql`select 1 from stage
             where code in ('HYBRID_UV', 'EMBOSSING', 'EMBOSS_DIE_CUT')
             group by 1 = 1 having count(*) = 3`,
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
