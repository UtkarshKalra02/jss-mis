/**
 * Un-apply a migration.
 *
 * drizzle-kit has no down command and never will — it applies forward only and
 * tracks what it applied by the SHA-256 of the migration file. So reversing one
 * means two things, and doing only the first is the trap:
 *
 *   1. run the matching file in drizzle/down/, and
 *   2. delete that migration's row from drizzle.__drizzle_migrations,
 *
 * because a database whose schema has been rolled back but whose journal still
 * claims the migration is applied will never re-apply it. `npm run db:migrate`
 * will report nothing pending against a database missing the columns.
 *
 * Both happen in ONE transaction. A down that drops the columns but fails to
 * clear the journal row leaves a database that cannot be repaired by either
 * direction.
 *
 * Usage — the env file is named every time, exactly as db:migrate requires:
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/migrate-down.ts 0051 0050
 *   DOTENV_CONFIG_PATH=.env.production.local npx tsx scripts/migrate-down.ts 0051 --yes
 *
 * Arguments are migration prefixes, applied in the order given. Give them
 * NEWEST FIRST: 0051 before 0050, or 0050's down will rebuild a view that
 * 0051's down then has to rebuild again, and 0048's column cannot be dropped
 * while a view still selects it.
 *
 * --yes is required for any database that is not the dev branch. Without it
 * this prints the plan and exits.
 *
 * --dry-run prints the statements and rolls back instead of committing. Worth
 * doing on production before the real thing: it proves the whole file parses
 * and runs against the real data without leaving anything behind.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

const DEV_HOST_PREFIX = "ep-polished-night";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--yes");
const prefixes = args.filter((a) => !a.startsWith("--"));

config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.local" });

/**
 * A chunk that is nothing but comments is not a statement.
 *
 * This was a regex — /^(--[^\n]*\n?)+$/ — and on these files it hung for
 * minutes with a transaction open. Every migration here opens with a sixty-line
 * comment header containing blank lines, so the match FAILS, and a failing
 * `(line)+` over sixty lines backtracks through every way of splitting them.
 * Checking the lines one at a time is linear and obvious.
 */
function isCommentOnly(chunk: string): boolean {
  return chunk
    .split("\n")
    .every((l) => l.trim() === "" || l.trim().startsWith("--"));
}

function resolve(prefix: string) {
  const up = readdirSync("drizzle").filter(
    (f) => f.startsWith(prefix) && f.endsWith(".sql"),
  );
  if (up.length !== 1) {
    throw new Error(
      `expected exactly one drizzle/${prefix}*.sql, found ${up.length}: ${up.join(", ")}`,
    );
  }
  const downDir = readdirSync(join("drizzle", "down")).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".down.sql"),
  );
  if (downDir.length !== 1) {
    throw new Error(
      `expected exactly one drizzle/down/${prefix}*.down.sql, found ${downDir.length}. ` +
        `A migration with no down file cannot be reversed by this script.`,
    );
  }
  const upPath = join("drizzle", up[0]);
  // The hash drizzle-kit stored is the SHA-256 of the UP file's bytes. It is
  // the only link between a file on disk and a row in the journal, which is why
  // editing an applied migration makes it re-apply.
  const hash = createHash("sha256").update(readFileSync(upPath)).digest("hex");
  return {
    tag: up[0].replace(/\.sql$/, ""),
    upPath,
    downPath: join("drizzle", "down", downDir[0]),
    hash,
  };
}

async function main() {
  if (prefixes.length === 0) {
    throw new Error("name at least one migration, newest first, e.g. 0051 0050");
  }

  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error(
      "DATABASE_URL_UNPOOLED is not set. Down migrations need the DIRECT Neon " +
        "URL (no '-pooler'), same as db:migrate.",
    );
  }
  const host = new URL(url).host;
  const isDev = host.startsWith(DEV_HOST_PREFIX);

  // The same line drizzle.config.ts prints, for the same reason: the two URLs
  // differ by a few characters and running this against the wrong one is silent.
  console.log(`migrate-down target: ${host}${isDev ? " (dev)" : "  *** NOT THE DEV BRANCH ***"}`);

  const plan = prefixes.map(resolve);
  console.log(`\nwill un-apply, in this order:`);
  for (const p of plan) console.log(`  ${p.tag}\n    down: ${p.downPath}\n    hash: ${p.hash}`);

  if (!isDev && !confirmed) {
    console.log(
      `\nRefusing: ${host} is not the dev branch and --yes was not given. ` +
        `Nothing has been run.`,
    );
    process.exit(2);
  }

  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = globalThis.WebSocket ?? ws;

  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();

  // RAISE NOTICE is how the down files report what they are about to lose.
  // Without this listener the warnings go nowhere.
  c.on("notice", (n: { message?: string }) => console.log(`  NOTICE: ${n.message ?? n}`));

  try {
    await c.query("BEGIN");
    for (const p of plan) {
      const applied = await c.query(
        `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1`,
        [p.hash],
      );
      if (applied.rows.length === 0) {
        throw new Error(
          `${p.tag} is not applied to ${host} (no journal row for its hash). ` +
            `Running its down file would act on a schema that does not have it.`,
        );
      }

      const statements = readFileSync(p.downPath, "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !isCommentOnly(s));

      console.log(`\n${p.tag}: ${statements.length} statement(s)`);
      for (const [i, stmt] of statements.entries()) {
        const first = stmt.split("\n").find((l) => l.trim() && !l.trim().startsWith("--")) ?? "";
        console.log(`  [${i + 1}/${statements.length}] ${first.slice(0, 92)}`);
        await c.query(stmt);
      }

      await c.query(`DELETE FROM drizzle.__drizzle_migrations WHERE hash = $1`, [p.hash]);
      console.log(`  journal row removed; db:migrate will see ${p.tag} as pending again`);
    }

    if (dryRun) {
      await c.query("ROLLBACK");
      console.log(`\n--dry-run: rolled back. Nothing changed on ${host}.`);
    } else {
      await c.query("COMMIT");
      console.log(`\nCommitted on ${host}.`);
    }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`\nRolled back. Nothing changed on ${host}.`);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
