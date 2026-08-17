import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next loads .env.local automatically; drizzle-kit runs outside Next and does
// not, so it has to be loaded explicitly. DOTENV_CONFIG_PATH lets a caller
// point this at another environment without editing the file.
config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.local" });

if (!process.env.DATABASE_URL_UNPOOLED) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Migrations need the DIRECT Neon URL " +
      "(no '-pooler' in the host). See .env.example.",
  );
}

/**
 * Print the host before doing anything.
 *
 * Migrations are run by hand against whichever database the environment points
 * at, and production and development differ by a few characters in a URL that
 * nobody reads carefully at 11pm. One line of output makes "I just migrated the
 * wrong database" a thing you notice immediately rather than later.
 */
console.log(`drizzle-kit target: ${new URL(process.env.DATABASE_URL_UNPOOLED).host}`);

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // DIRECT connection, not the pooled one. Migrations need a stable session
    // for advisory locks and DDL; a pooler can hand successive statements to
    // different backends.
    url: process.env.DATABASE_URL_UNPOOLED,
  },
  // Must match the `casing` passed to drizzle() in src/db/index.ts, or the
  // generated SQL and the runtime queries will disagree about column names.
  casing: "snake_case",
  verbose: true,
  strict: true,
});
