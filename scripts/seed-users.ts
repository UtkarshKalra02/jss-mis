/**
 * Seeds the real users from spec section 2.
 *
 * Every account is created with NO USABLE PASSWORD (password_hash null). The
 * account exists, appears in the admin list, and can be assigned work, but it
 * cannot authenticate until someone runs:
 *
 *   npm run set-password -- <username>
 *
 * Passwords are never written into this file, a config file, or an env var.
 * A file containing passwords is a file that can be committed, copied, or left
 * on a laptop; a password that is never written down cannot leak that way.
 *
 * Idempotent — re-running adds missing users and leaves existing ones (and
 * their passwords) untouched.
 *
 * Run: npm run seed:users
 */
import { config } from "dotenv";

import type { Role } from "../src/auth/roles";

/*
 * DEV BY DEFAULT, PRODUCTION ONLY WHEN ASKED FOR BY NAME:
 *
 *   DOTENV_CONFIG_PATH=.env.production.local npm run seed:users
 *
 * This honoured nothing and always loaded .env.local, which meant the command
 * above ran happily against DEV and reported success — the account was created
 * on the wrong database and the right one still had nothing. Same switch as
 * scripts/export-store.ts, so every script that can reach production reaches it
 * the same way. The banner below names the host it actually connected to, so a
 * run against the wrong database is visible rather than inferred.
 */
config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.local" });

/*
 * src/lib/env.ts insists on AUTH_SECRET before src/db will load, and
 * .env.production.local deliberately holds only the two connection strings
 * (DEPLOYMENT.md §2). A placeholder is honest here: this script inserts user rows and
 * never signs a session, so the value is never used for anything. Same shim,
 * and the same reason, as scripts/export-store.ts.
 */
process.env.AUTH_SECRET ??= "unused-by-seed-script";


// Imported dynamically inside main(). A static import would be HOISTED above
// the config() call, so src/lib/env.ts would validate an empty environment and
// throw before dotenv had a chance to populate it. Dynamic import also means
// an import-sorting rule cannot silently reintroduce the bug.
type DbModule = typeof import("../src/db");
type SchemaModule = typeof import("../src/db/schema");

const USERS: { username: string; name: string; role: Role }[] = [
  { username: "utkarsh", name: "Utkarsh Kalra", role: "ADMIN" },
  { username: "deepak", name: "Deepak", role: "ADMIN" },
  { username: "punit", name: "Punit", role: "ORDER_DESK" },
  { username: "preeti", name: "Preeti", role: "PLANNER" },
  { username: "pradeep", name: "Pradeep", role: "ACCOUNTS" },
  { username: "ajay", name: "Ajay", role: "FLOOR" },
  { username: "amit", name: "Amit Kalra", role: "OWNER" },
  // S4. "Admin but not admin": enters everything, configures nothing. Seeded
  // here rather than created by hand so the account is reproducible on a fresh
  // database, and so what it is for is written down next to it.
  { username: "dataentry", name: "Data Entry", role: "DATA_ENTRY_FULL" },
];

/**
 * The database host this run actually connected to, with no credentials in it.
 *
 * Printed because the failure it guards against is silent: a command aimed at
 * production that quietly loads the dev environment reports every success it
 * would have reported anyway, and the account ends up on the wrong database.
 */
function targetHost(): string {
  const url = process.env.DATABASE_URL ?? "";
  try {
    return new URL(url).host;
  } catch {
    return "unknown host";
  }
}

async function main() {
  console.log(`Database: ${targetHost()}\n`);
  const { eq } = await import("drizzle-orm");
  const { db }: DbModule = await import("../src/db");
  const { appUser }: SchemaModule = await import("../src/db/schema");

  let created = 0;
  let skipped = 0;

  let withheld = 0;

  for (const u of USERS) {
    /*
     * EVERY row for this username, deleted ones included.
     *
     * Matching only live rows is what made this script recreate an account
     * somebody had deliberately removed: `deepak` was soft-deleted on 5 Oct
     * 2026, the live-rows-only lookup found nothing on 12 Oct, and a second
     * active ADMIN row appeared on production beside the dead one. Removing a
     * user is a decision, and a seed script re-running must not quietly
     * overturn it.
     */
    const rows = await db
      .select({ id: appUser.id, deletedAt: appUser.deletedAt })
      .from(appUser)
      .where(eq(appUser.username, u.username));

    const live = rows.find((r) => r.deletedAt === null);

    if (live) {
      console.log(`  = ${u.username.padEnd(10)} already exists, untouched`);
      skipped++;
      continue;
    }

    if (rows.length > 0) {
      // Says so loudly rather than creating one. Restoring it is a deliberate
      // act on the Admin screen, by somebody who knows why it went.
      console.log(
        `  ! ${u.username.padEnd(10)} EXISTS BUT WAS REMOVED — not recreated. Restore it in Admin › Users if that was wrong.`,
      );
      withheld++;
      continue;
    }

    await db.insert(appUser).values({
      username: u.username,
      name: u.name,
      role: u.role,
      passwordHash: null, // no usable password — see the note above
      isActive: true,
    });

    console.log(`  + ${u.username.padEnd(10)} ${u.role}`);
    created++;
  }

  console.log(
    `\n${created} created, ${skipped} already present` +
      (withheld > 0 ? `, ${withheld} withheld because they were removed.` : "."),
  );

  if (created > 0) {
    console.log("\nNobody can sign in yet. For each user, run:");
    console.log("  npm run set-password -- <username>");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
