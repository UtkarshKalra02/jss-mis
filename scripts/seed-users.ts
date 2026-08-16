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

config({ path: ".env.local" });

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
];

async function main() {
  const { and, eq, isNull } = await import("drizzle-orm");
  const { db }: DbModule = await import("../src/db");
  const { appUser }: SchemaModule = await import("../src/db/schema");

  let created = 0;
  let skipped = 0;

  for (const u of USERS) {
    const [existing] = await db
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.username, u.username), isNull(appUser.deletedAt)))
      .limit(1);

    if (existing) {
      console.log(`  = ${u.username.padEnd(10)} already exists, untouched`);
      skipped++;
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

  console.log(`\n${created} created, ${skipped} already present.`);

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
