import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next loads .env.local automatically; drizzle-kit runs outside Next and does
// not, so it has to be loaded explicitly.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // DIRECT connection, not the pooled one. Migrations need a stable session
    // for advisory locks and DDL; a pooler can hand successive statements to
    // different backends.
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
  // Must match the `casing` passed to drizzle() in src/db/index.ts, or the
  // generated SQL and the runtime queries will disagree about column names.
  casing: "snake_case",
  verbose: true,
  strict: true,
});
