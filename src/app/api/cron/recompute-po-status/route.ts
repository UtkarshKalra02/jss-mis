import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { recomputeAllStatuses } from "@/db/po-status";

/**
 * The nightly half of "derived nightly + on write" (spec section 4.3).
 *
 * The on-write half is already complete and needs nothing from here: AFTER
 * triggers on dispatch_line, dispatch and po_item.ordered_qty recompute status
 * as a consequence of the write itself, so there is no call site that can
 * forget. This route exists for the drift those triggers cannot see — a row
 * repaired by hand at psql, a restore from backup, a bulk fix run outside the
 * application.
 *
 * On a healthy night it changes nothing and writes no audit rows, because the
 * SQL functions only write when the computed value actually differs.
 *
 * Scheduled from vercel.json at 19:30 UTC, which is 01:00 IST — after the
 * factory has stopped entering anything and before anyone looks at a dashboard.
 * Vercel cron schedules are always UTC, which is why the number in that file
 * does not look like 1am.
 */
export const dynamic = "force-dynamic";

const digest = (value: string) => createHash("sha256").update(value).digest();

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;

  // Fail CLOSED. An unset secret must never mean "let everyone in" — this
  // endpoint writes to every PO item in the database.
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set, so this endpoint is disabled." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("authorization") ?? "";

  // Hashed before comparing so both sides are the same length regardless of
  // input, which is what timingSafeEqual requires.
  if (!timingSafeEqual(digest(provided), digest(`Bearer ${expected}`))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const started = Date.now();
  const { items } = await recomputeAllStatuses();

  return NextResponse.json({ ok: true, items, ms: Date.now() - started });
}
