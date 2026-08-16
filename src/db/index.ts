import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { env } from "@/lib/env";

/**
 * Database connection.
 *
 * Driver choice is load-bearing, so it is worth understanding before changing it.
 *
 * Neon offers two Drizzle adapters:
 *   - `neon-http`  — one HTTP request per query. Lowest latency for single
 *                    queries, but it CANNOT do interactive transactions.
 *   - `neon-serverless` — a WebSocket-backed Pool that behaves like real
 *                    node-postgres, and CAN do transactions.
 *
 * We need `neon-serverless`. The audit wrapper (src/db/audit.ts) writes the
 * mutation and its audit_log row inside one transaction, so a write can never
 * land without its audit trail. Non-negotiable 3 is only actually enforceable
 * with real transactions. Switching to neon-http would silently break it.
 *
 * `casing: "snake_case"` lets the TypeScript schema use camelCase identifiers
 * while Postgres gets the snake_case column names the spec asks for. This must
 * stay in sync with the same setting in drizzle.config.ts.
 */
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { casing: "snake_case" });

export type Db = typeof db;
