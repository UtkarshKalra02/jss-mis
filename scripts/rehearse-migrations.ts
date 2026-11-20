/**
 * Rehearse pending migrations against a real database, then ROLL BACK.
 *
 * WHY THIS EXISTS. drizzle-kit applies every pending migration in ONE
 * transaction, with no way to stop part-way. A database that has had them
 * applied one at a time, days apart — which is what dev always is — has never
 * tested that. The batch is only ever tested once, on the database it matters
 * on, unless something like this runs first.
 *
 * It answers, on real data, the questions the SOP brief's section 4 asks
 * before a promotion:
 *
 *   1. do the up files apply together;
 *   2. do the existing views return the same rows afterwards, for data nobody
 *      touched — compared on the columns they ALREADY HAD, so a view that gains
 *      a trailing column does not read as the data having changed;
 *   3. is any existing row updated or deleted, or any audit row written;
 *   4. do the down files put the schema back exactly as it was.
 *
 * Nothing is committed, on any database, ever. There is no flag to make it
 * commit — use `npm run db:migrate` for that.
 *
 * Usage — the env file is named every time, as db:migrate requires:
 *
 *   DOTENV_CONFIG_PATH=.env.production.local \
 *     npx tsx scripts/rehearse-migrations.ts 0047 0048 0049 0050 0051
 *
 * Prefixes are given OLDEST FIRST, in the order drizzle would apply them. The
 * down files are run in the reverse order automatically, which is the order
 * they need: a column cannot be dropped while a later migration's view still
 * selects it.
 *
 * A migration with no file in drizzle/down/ makes the down half impossible, so
 * the run does checks 1 to 3 and says plainly that it skipped check 4.
 *
 * WHAT IT LEAVES BEHIND: one consumed sequence value on
 * drizzle.__drizzle_migrations if a later run inserts there — which is why that
 * table's id runs ahead of the number of rows in it. Nothing else.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.local" });

const prefixes = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/**
 * A chunk that is nothing but comments is not a statement.
 *
 * This was a regex — /^(--[^\n]*\n?)+$/ — and on these files it hung for
 * minutes with a transaction open on production. Every migration opens with a
 * long comment header containing blank lines, so the match FAILS, and a failing
 * `(line)+` backtracks through every way of splitting those lines. Checking the
 * lines one at a time is linear and obvious.
 */
function isCommentOnly(chunk: string): boolean {
  return chunk.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--"));
}

function statementsIn(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isCommentOnly(s));
}

function resolve(prefix: string) {
  const up = readdirSync("drizzle").filter((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (up.length !== 1) {
    throw new Error(`expected exactly one drizzle/${prefix}*.sql, found ${up.length}`);
  }
  const downPath = join("drizzle", "down", up[0].replace(/\.sql$/, ".down.sql"));
  return {
    tag: up[0].replace(/\.sql$/, ""),
    upPath: join("drizzle", up[0]),
    downPath: existsSync(downPath) ? downPath : null,
  };
}

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

async function main() {
  if (prefixes.length === 0) {
    throw new Error("name at least one migration, oldest first, e.g. 0047 0048 0049");
  }
  const plan = prefixes.map(resolve);
  const missingDown = plan.filter((p) => p.downPath === null);

  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error(
      "DATABASE_URL_UNPOOLED is not set. This needs the DIRECT Neon URL " +
        "(no '-pooler'), same as db:migrate.",
    );
  }
  const host = new URL(url).host;

  // The same line drizzle.config.ts prints, for the same reason: the two URLs
  // differ by a few characters and reading the wrong one is silent.
  console.log(`rehearsal target: ${host}   (one transaction, always rolled back)`);
  console.log(`\nup, in order:`);
  for (const p of plan) console.log(`  ${p.tag}${p.downPath ? "" : "   (no down file)"}`);

  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = globalThis.WebSocket ?? ws;
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  const notices: string[] = [];
  c.on("notice", (n: { message?: string }) => notices.push(String(n.message ?? n)));

  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await c.query(sql, params)).rows[0] as T;
  const col = async (sql: string, params: unknown[] = []): Promise<string[]> =>
    (await c.query(sql, params)).rows.map((r) => (r as { x: string }).x);

  const viewNames = () =>
    col(`SELECT viewname AS x FROM pg_views WHERE schemaname = 'public' ORDER BY 1`);

  const columnsOf = (rel: string) =>
    col(
      `SELECT a.attname AS x FROM pg_attribute a
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [rel],
    );

  /**
   * Checksum a view over a FIXED column list.
   *
   * Reading `t::text` instead would change the moment a column is appended,
   * which is exactly what these migrations do deliberately — so a whole-row
   * checksum reports a change in the data when only the shape changed.
   */
  const viewChecksum = async (view: string, cols: string[]) => {
    if (cols.length === 0) return { rows: 0, checksum: "(no columns)" };
    const row = cols.map((x) => `t.${JSON.stringify(x)}`).join(", ");
    return one<{ rows: number; checksum: string }>(
      `SELECT count(*)::int AS rows,
              md5(coalesce(string_agg((ROW(${row}))::text, '|'
                                      ORDER BY (ROW(${row}))::text), '')) AS checksum
         FROM ${view} t`,
    );
  };

  /** Everything about the schema a down migration has to put back. */
  const fingerprint = async () => ({
    columns: await col(`SELECT c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)
                          ||CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                          ||coalesce(' DEFAULT '||pg_get_expr(d.adbin,d.adrelid),'') AS x
                        FROM pg_attribute a
                        JOIN pg_class c ON c.oid = a.attrelid
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                       WHERE n.nspname='public' AND c.relkind IN ('r','v')
                         AND a.attnum > 0 AND NOT a.attisdropped ORDER BY 1`),
    constraints: await col(`SELECT con.conrelid::regclass||' '||con.conname||' '
                                 ||pg_get_constraintdef(con.oid) AS x
                              FROM pg_constraint con
                              JOIN pg_namespace n ON n.oid = con.connamespace
                             WHERE n.nspname='public' ORDER BY 1`),
    indexes: await col(`SELECT indexname||' '||indexdef AS x FROM pg_indexes
                         WHERE schemaname='public' ORDER BY 1`),
    functions: await col(`SELECT p.proname||' '||md5(pg_get_functiondef(p.oid)) AS x
                            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                           WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1`),
    triggers: await col(`SELECT t.tgname||' '||pg_get_triggerdef(t.oid) AS x FROM pg_trigger t
                           JOIN pg_class c ON c.oid = t.tgrelid
                           JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY 1`),
    views: await col(`SELECT viewname||' '||md5(pg_get_viewdef(
                             (quote_ident(schemaname)||'.'||quote_ident(viewname))::regclass,
                             true)) AS x
                        FROM pg_views WHERE schemaname='public' ORDER BY 1`),
    enums: await col(`SELECT t.typname||' '||coalesce(
                             string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder), '') AS x
                        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                        LEFT JOIN pg_enum e ON e.enumtypid = t.oid
                       WHERE n.nspname='public' AND t.typtype='e'
                       GROUP BY t.typname ORDER BY 1`),
    settings: await col(`SELECT key||'='||value AS x FROM app_setting ORDER BY 1`),
  });

  /**
   * Readings that move if an existing row is written.
   *
   * `touch_updated_at` fires on every UPDATE, so max(updated_at) moving is the
   * cheapest proof that something was touched; audit_log is append-only, so its
   * count moving is proof a write went through the wrapper.
   */
  const marks = () =>
    one<Record<string, string>>(
      `SELECT (SELECT count(*)::int FROM audit_log)              AS audit_rows,
              (SELECT max(changed_at)::text FROM audit_log)      AS audit_newest,
              (SELECT max(updated_at)::text FROM po_item)        AS po_item_newest,
              (SELECT max(updated_at)::text FROM purchase_order) AS po_newest,
              (SELECT max(updated_at)::text FROM job_card)       AS jc_newest,
              (SELECT count(*)::int FROM po_item)                AS po_items,
              (SELECT count(*)::int FROM purchase_order)         AS purchase_orders,
              (SELECT count(*)::int FROM job_card)               AS job_cards,
              (SELECT count(*)::int FROM dispatch_line)          AS dispatch_lines,
              (SELECT count(*)::int FROM stage_event)            AS stage_events`,
    );

  const apply = async (label: string, paths: string[]) => {
    const t0 = Date.now();
    let n = 0;
    for (const p of paths) {
      for (const stmt of statementsIn(p)) {
        await c.query(stmt);
        n++;
      }
    }
    console.log(`\n${label}: ${n} statements across ${paths.length} files in ${Date.now() - t0} ms`);
  };

  try {
    await c.query("BEGIN");
    // Every date comparison in this schema assumes IST (C10), so the rehearsal
    // reads the views in the timezone the application reads them in.
    await c.query("SET LOCAL TIME ZONE 'Asia/Kolkata'");
    // Fail fast rather than queue behind a live user's lock while holding
    // ACCESS EXCLUSIVE on po_item ourselves.
    await c.query("SET LOCAL lock_timeout = '15s'");
    await c.query("SET LOCAL statement_timeout = '180s'");

    const views = await viewNames();
    const cols: Record<string, string[]> = {};
    for (const v of views) cols[v] = await columnsOf(v);
    const before: Record<string, { rows: number; checksum: string }> = {};
    for (const v of views) before[v] = await viewChecksum(v, cols[v]);
    const fpBefore = await fingerprint();
    const markBefore = await marks();

    await apply(`UP   ${plan[0].tag} .. ${plan[plan.length - 1].tag}`, plan.map((p) => p.upPath));

    console.log(`\n=== 1. the existing views, on the columns they already had ===`);
    for (const v of views) {
      const a = await viewChecksum(v, cols[v]);
      const b = before[v];
      check(
        b.rows === a.rows && b.checksum === a.checksum,
        v.padEnd(26),
        `${b.rows} -> ${a.rows} rows${b.checksum === a.checksum ? "" : ", checksum differs"}`,
      );
    }

    console.log(`\n=== 2. no existing row was written, and no audit row ===`);
    const markAfter = await marks();
    for (const k of Object.keys(markBefore)) {
      check(
        String(markBefore[k]) === String(markAfter[k]),
        k.padEnd(26),
        `${markBefore[k]} -> ${markAfter[k]}`,
      );
    }

    console.log(`\n=== 3. what the batch added ===`);
    const fpMid = await fingerprint();
    for (const k of Object.keys(fpBefore) as (keyof typeof fpBefore)[]) {
      const added = fpMid[k].filter((x) => !fpBefore[k].includes(x));
      const removed = fpBefore[k].filter((x) => !fpMid[k].includes(x));
      console.log(`  ${k}: +${added.length} -${removed.length}`);
      for (const x of added) console.log(`      + ${x.slice(0, 150)}`);
      for (const x of removed) console.log(`      - ${x.slice(0, 150)}`);
    }

    if (missingDown.length > 0) {
      console.log(
        `\n=== 4. SKIPPED — no down file for ${missingDown.map((p) => p.tag).join(", ")} ===`,
      );
      console.log(`  The schema cannot be proved reversible without one.`);
      failures++;
    } else {
      await apply(
        `DOWN ${plan[plan.length - 1].tag} .. ${plan[0].tag}`,
        [...plan].reverse().map((p) => p.downPath as string),
      );

      console.log(`\n=== 4. the down files restore the schema exactly ===`);
      const fpAfter = await fingerprint();
      for (const k of Object.keys(fpBefore) as (keyof typeof fpBefore)[]) {
        const b = fpBefore[k];
        const a = fpAfter[k];
        const missing = b.filter((x) => !a.includes(x));
        const extra = a.filter((x) => !b.includes(x));
        check(
          missing.length === 0 && extra.length === 0,
          `${k.padEnd(12)} (${b.length} objects)`,
          missing.length || extra.length
            ? `\n          missing: ${missing.join("\n                   ") || "—"}` +
                `\n          extra:   ${extra.join("\n                   ") || "—"}`
            : "",
        );
      }

      console.log(`\n=== 5. the views read the same again after the down ===`);
      for (const v of views) {
        const a = await viewChecksum(v, cols[v]);
        const b = before[v];
        check(b.rows === a.rows && b.checksum === a.checksum, v.padEnd(26),
              `${b.rows} -> ${a.rows} rows`);
      }
    }
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    console.log(`\nROLLED BACK. ${host} is unchanged.`);
    c.release();
    await pool.end();
  }

  if (notices.length) {
    console.log(`\n--- ${notices.length} server notice(s) ---`);
    for (const n of notices) console.log(`  ${n}`);
  }
  console.log(`\n==== rehearsal ${failures === 0 ? "PASSED" : `FAILED (${failures})`} ====`);
  console.log(
    `\nA view containing now() — v_wip_ageing does — cannot be checksummed across a\n` +
      `gap in time. That is why every comparison here happens inside ONE transaction,\n` +
      `where now() is frozen at transaction start. See docs/DECISIONS.md BB6.`,
  );
  if (failures) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
