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
 * Liveness probe, and the first thing to check after a deploy.
 *
 * `nativeWebSocket` is the field worth reading: when it is false the Neon
 * driver has fallen back to the bundled `ws` package, which is the exact
 * configuration that produced `b.mask is not a function` in production.
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

    // The success case carries no secrets, so it stays public — `ist_now` in
    // particular needs to be checkable without ceremony after every deploy.
    return NextResponse.json({ ok: true, ...result.rows[0], runtime: runtimeInfo });
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
