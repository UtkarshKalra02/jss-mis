import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { env } from "@/lib/env";

import * as schema from "./schema";

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
/*
 * Node 22 and later ship a global WebSocket, so the `ws` package is only a
 * fallback for older runtimes. Preferring the built-in is not a micro
 * optimisation — it works around a real failure in production builds:
 *
 * `ws` has an OPTIONAL native dependency, `bufferutil`, which is not installed
 * here. At runtime in plain Node its `require('bufferutil')` throws, `ws`
 * catches it and uses its pure-JS masking. But a BUNDLER resolves that require
 * to an empty stub rather than letting it throw, so the try block succeeds and
 * `ws` installs a mask function that calls `bufferUtil.mask(...)` — which is
 * undefined.
 *
 * The result is `TypeError: b.mask is not a function`, and only for WebSocket
 * frames of 48 bytes or more, since `ws` uses its own implementation below that
 * threshold. Small queries succeed and larger ones fail, which makes it look
 * like a database problem rather than a bundling one.
 *
 * `serverExternalPackages: ["ws"]` in next.config.ts keeps `ws` out of the
 * bundle so the fallback path is safe too, on the older runtimes that need it.
 */
neonConfig.webSocketConstructor = globalThis.WebSocket ?? ws;

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Db = typeof db;
