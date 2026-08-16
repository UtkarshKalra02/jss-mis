import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";

// bcrypt and the Neon WebSocket driver both need Node APIs, so nothing in this
// app runs on the edge runtime. Stated explicitly rather than relied upon.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe. Confirms the app can actually reach Neon and that the
 * session timezone is what every date calculation in this system assumes.
 */
export async function GET() {
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

    return NextResponse.json({ ok: true, ...result.rows[0] });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}
