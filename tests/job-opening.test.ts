import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { poItem, purchaseOrder } from "@/db/schema";
import { jobOpening } from "@/modules/dashboard/queries";
import { nowISTLocalInput, wallClockIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";
import { poItemConfirmationSchema, poItemSchema } from "@/modules/purchase-orders/validation";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Job opening discipline — SOP Rule 1 (W).
 *
 * The thing worth testing here is NOT "does the column save". It is the
 * arithmetic: working_minutes_between() has to skip nights, skip the weekly
 * day off, and refuse to be fooled by the server's clock being on UTC. Every
 * one of those, got wrong, produces a number that looks plausible and is
 * wrong in the flattering direction — which is the only kind of wrong that
 * survives in a reporting system.
 *
 * Dates here are FIXED calendar dates with an explicit +05:30 offset, not
 * offsets from today_ist(). That is the opposite of the C10 rule the other
 * suites follow, and deliberately: these cases are about specific times of
 * day and specific weekdays, so they have to be pinned. Nothing here compares
 * against "now", so nothing here drifts.
 */

/* 16 Nov 2026 is a Monday; 14 Nov a Saturday; 15 Nov a Sunday. */
const MON_1000 = "2026-11-16T10:00:00+05:30";
const MON_1130 = "2026-11-16T11:30:00+05:30";
const MON_1800 = "2026-11-16T18:00:00+05:30";
const TUE_1000 = "2026-11-17T10:00:00+05:30";
const SAT_1800 = "2026-11-14T18:00:00+05:30";
const MON_0800 = "2026-11-16T08:00:00+05:30";
const MON_1900 = "2026-11-16T19:00:00+05:30";
const MON_2000 = "2026-11-16T20:00:00+05:30";
const MON_0930 = "2026-11-16T09:30:00+05:30";
const MON_1730 = "2026-11-16T17:30:00+05:30";
const MON_1830 = "2026-11-16T18:30:00+05:30";
const TUE_1800 = "2026-11-17T18:00:00+05:30";

/**
 * The shift as it really is: 09:30-18:00, Sunday off (Utkarsh, 18 Nov 2026).
 *
 * SET EXPLICITLY IN EVERY TEST rather than relied on from app_setting. The
 * window is a setting somebody is expected to change, so a suite that read
 * whatever is currently stored would go red the first time Utkarsh corrected
 * the shift — and the failure would look like a bug in the arithmetic. These
 * numbers are about the arithmetic. One test below deliberately changes the
 * window, to prove it IS read from the setting.
 */
const SHIFT = { start: 570, end: 1080, offDow: 0 };

async function setWindow(
  tx: Tx,
  w: { start: number; end: number; offDow: number },
): Promise<void> {
  for (const [key, value] of [
    ["work_day_start_min", w.start],
    ["work_day_end_min", w.end],
    ["work_week_off_dow", w.offDow],
  ] as const) {
    await tx.execute(sql`
      insert into app_setting (key, value) values (${key}, ${String(value)})
      on conflict (key) do update set value = ${String(value)}
    `);
  }
}

async function minutes(tx: Tx, from: string | null, to: string | null): Promise<number | null> {
  const r = await tx.execute(
    sql`select working_minutes_between(${from}::timestamptz, ${to}::timestamptz) as m`,
  );
  const value = (r.rows as { m: number | string | null }[])[0]!.m;
  return value === null ? null : Number(value);
}

/** Pins the shift, runs the body, rolls everything back. */
function onShift(fn: (ask: (from: string | null, to: string | null) => Promise<number | null>) => Promise<void>) {
  return inRollback(async (tx) => {
    await setWindow(tx, SHIFT);
    await fn((from, to) => minutes(tx, from, to));
  });
}

describe("working_minutes_between", () => {
  it("counts plain minutes inside one working day", async () => {
    await onShift(async (ask) => {
      expect(await ask(MON_1000, MON_1130)).toBe(90);
    });
  });

  it("skips the night — 18:00 Monday to 10:00 Tuesday is half an hour", async () => {
    // 18:00 IS the end of the shift, so Monday contributes nothing and this is
    // Tuesday 09:30-10:00. NOT 16 hours.
    await onShift(async (ask) => {
      expect(await ask(MON_1800, TUE_1000)).toBe(30);
    });
  });

  it("skips the weekly day off — Saturday evening to Monday morning", async () => {
    // Sunday contributes nothing at all, so this is the same 30 as above.
    await onShift(async (ask) => {
      expect(await ask(SAT_1800, MON_1000)).toBe(30);
    });
  });

  it("ignores time before the shift starts", async () => {
    // Confirmed at 08:00, opened at 10:00: the clock only runs from 09:30.
    await onShift(async (ask) => {
      expect(await ask(MON_0800, MON_1000)).toBe(30);
    });
  });

  it("returns zero for a span entirely after hours", async () => {
    await onShift(async (ask) => {
      expect(await ask(MON_1900, MON_2000)).toBe(0);
    });
  });

  /*
   * OVERTIME IS NOT COUNTED, and that makes this measure generous rather than
   * harsh. A job confirmed at 17:30 and opened at 19:00 — during overtime —
   * scores the thirty minutes to 18:00, not ninety. The number exists to
   * catch jobs left sitting overnight, not to penalise somebody for working
   * late, so this is the right direction to be wrong in.
   */
  it("stops the clock at 18:00 and does not count overtime", async () => {
    await onShift(async (ask) => {
      expect(await ask(MON_1730, MON_1900)).toBe(30);
    });
  });

  it("counts a full shift as the full shift", async () => {
    // 09:30 to 18:00 is eight and a half hours.
    await onShift(async (ask) => {
      expect(await ask(MON_0930, MON_1800)).toBe(510);
    });
  });

  it("adds whole days together", async () => {
    await onShift(async (ask) => {
      expect(await ask(MON_0930, TUE_1800)).toBe(1020);
    });
  });

  /*
   * THE WINDOW IS A SETTING, NOT A CONSTANT. The same Monday reads differently
   * once the shift is lengthened, which is what lets Utkarsh correct the hours
   * in Admin instead of asking for a migration.
   */
  it("reads the window from app_setting", async () => {
    await inRollback(async (tx) => {
      await setWindow(tx, SHIFT);
      expect(await minutes(tx, MON_0930, MON_1800)).toBe(510);

      await setWindow(tx, { ...SHIFT, end: 1110 });
      expect(await minutes(tx, MON_0930, MON_1800)).toBe(510);
      expect(await minutes(tx, MON_0930, MON_1830)).toBe(540);
    });
  });

  it("honours a different weekly day off", async () => {
    await inRollback(async (tx) => {
      // Sunday off: Saturday evening to Monday morning is Monday's half-hour.
      await setWindow(tx, SHIFT);
      expect(await minutes(tx, SAT_1800, MON_1000)).toBe(30);

      /*
       * Monday off instead. The same span now LOSES Monday's half-hour and
       * GAINS a full Sunday shift, because Sunday has become a working day —
       * 510, not 0. Worth spelling out: the obvious expectation here is zero,
       * and it is wrong. Moving the day off moves work onto the other day.
       */
      await setWindow(tx, { ...SHIFT, offDow: 1 });
      expect(await minutes(tx, SAT_1800, MON_1000)).toBe(510);
    });
  });

  /*
   * ZERO, NOT NULL, when the order is reversed. The confirmation and the row
   * are written in the same form submit and their timestamps can land either
   * side of each other by milliseconds. Returning null there would drop the
   * item out of the metric entirely — a silent exclusion, which is worse than
   * a slightly generous zero. A genuinely future-dated confirmation is
   * refused by the form instead (see the schema test below).
   */
  it("clamps a reversed pair to zero rather than excluding it", async () => {
    await onShift(async (ask) => {
      expect(await ask(MON_1130, MON_1000)).toBe(0);
    });
  });

  it("is null when either end is missing", async () => {
    await onShift(async (ask) => {
      expect(await ask(null, MON_1000)).toBeNull();
      expect(await ask(MON_1000, null)).toBeNull();
    });
  });

  /* Runaway guard, not a business rule: the loop is per day. */
  it("is null for a span longer than a year", async () => {
    await onShift(async (ask) => {
      expect(await ask("2024-01-01T10:00:00+05:30", MON_1000)).toBeNull();
    });
  });

  /*
   * THE UTC TRAP. If the function read the timestamps in the server's zone
   * instead of Asia/Kolkata, 10:00 IST would be 04:30 — before the shift —
   * and this would come back as 0 instead of 90. That is the failure the
   * whole helper exists to prevent, so it gets its own test.
   */
  it("reads the clock in IST, not in the server's zone", async () => {
    await onShift(async (ask) => {
      expect(await ask("2026-11-16T04:30:00Z", "2026-11-16T06:00:00Z")).toBe(90);
    });
  });
});

/* -------------------------------------------------------------------------- */

async function makeItem(
  tx: Tx,
  confirmation: { source: string; at: string } | null,
) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("JO")}, 'Job Opening Co') returning id`,
    )
  ).rows as { id: string }[];

  const order = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", "2026-11-16"),
      clientId: c!.id,
      poDate: "2026-11-16",
    },
    tx,
  );

  return auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-11-16"),
      purchaseOrderId: order.id,
      itemName: "Opening test carton",
      orderedQty: 1000,
      committedDate: "2026-12-01",
      ...(confirmation
        ? {
            confirmationSource: confirmation.source as "PO",
            confirmedBy: SYSTEM_ACTOR.id,
            confirmedAt: new Date(confirmation.at),
          }
        : {}),
    },
    tx,
  );
}

async function opening(tx: Tx, poItemId: string) {
  const r = await tx.execute(sql`
    select confirmation_source, open_working_minutes, opened_on_time, target_working_minutes,
           opened_at = (select created_at from po_item where id = ${poItemId}) as opened_at_is_created_at
    from v_job_opening where po_item_id = ${poItemId}
  `);
  return (r.rows as {
    confirmation_source: string | null;
    open_working_minutes: number | string | null;
    opened_on_time: boolean | null;
    target_working_minutes: number | string;
    opened_at_is_created_at: boolean;
  }[])[0]!;
}

describe("v_job_opening", () => {
  /*
   * THE ROWS THAT MUST NOT BE SCORED. Every item that existed before this
   * migration, and everything the importer writes, has no confirmation. They
   * have to read NULL, not false — the same rule v_otd follows for items with
   * no committed date. If they read false, "items opened late" becomes the
   * entire history of the company on day one and nobody looks at it again.
   */
  it("reports null, never false, for an item with no confirmation recorded", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, null);
      const row = await opening(tx, item.id);

      expect(row.confirmation_source).toBeNull();
      expect(row.open_working_minutes).toBeNull();
      expect(row.opened_on_time).toBeNull();
    });
  });

  it("exposes opened_at as created_at, with no second column to disagree", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, null);
      expect((await opening(tx, item.id)).opened_at_is_created_at).toBe(true);
    });
  });

  it("scores an item confirmed moments ago as on time", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, {
        source: "WhatsApp",
        at: new Date(Date.now() - 60_000).toISOString(),
      });
      const row = await opening(tx, item.id);

      expect(row.confirmation_source).toBe("WhatsApp");
      expect(row.opened_on_time).toBe(true);
    });
  });

  /*
   * A confirmation from four working days ago cannot be on time under any
   * window setting, which is why this case is pinned to days rather than
   * hours — it stays true whatever the shift is set to, and whatever time of
   * day the suite happens to run.
   */
  it("scores an item confirmed days ago as late", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, {
        source: "Verbal",
        at: new Date(Date.now() - 4 * 24 * 3600_000).toISOString(),
      });
      const row = await opening(tx, item.id);

      expect(row.opened_on_time).toBe(false);
      expect(Number(row.open_working_minutes)).toBeGreaterThan(
        Number(row.target_working_minutes),
      );
    });
  });

  it("reads the target from app_setting, not a constant", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, {
        source: "PO",
        at: new Date(Date.now() - 4 * 24 * 3600_000).toISOString(),
      });
      expect((await opening(tx, item.id)).opened_on_time).toBe(false);

      // A week's worth of working minutes as the target: the same row passes.
      await tx.execute(sql`
        insert into app_setting (key, value) values ('job_open_target_working_minutes', '100000')
        on conflict (key) do update set value = '100000'
      `);
      expect((await opening(tx, item.id)).opened_on_time).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("po_item_confirmation_all_or_none", () => {
  /*
   * This is the 0046 lesson as a test. A CHECK whose expression evaluates to
   * NULL PASSES, so the obvious spelling of "all three present" accepts one
   * of three. 0045 shipped exactly that bug on the bundle columns and it was
   * a test, not a review, that found it. Hence one case per missing column.
   */
  const partials = [
    ["source only", sql`confirmation_source = 'PO'`],
    ["taker only", sql`confirmed_by = ${SYSTEM_ACTOR.id}`],
    ["time only", sql`confirmed_at = now()`],
  ] as const;

  for (const [label, assignment] of partials) {
    it(`refuses ${label}`, async () => {
      await inRollback(async (tx) => {
        const item = await makeItem(tx, null);

        const result = await expectFailure(tx, (sp) =>
          sp.execute(sql`update po_item set ${assignment} where id = ${item.id}`),
        );

        expect(result.threw).toBe(true);
        expect(result.message).toContain("po_item_confirmation_all_or_none");
      });
    });
  }

  it("accepts all three together", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, { source: "PO", at: new Date().toISOString() });
      expect((await opening(tx, item.id)).confirmation_source).toBe("PO");
    });
  });

  it("accepts none of the three", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, null);
      expect((await opening(tx, item.id)).confirmation_source).toBeNull();
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("wallClockIST", () => {
  /*
   * The browser posts "2026-11-16T10:00" with no zone on it. new Date() of
   * that resolves against the SERVER's clock, and the server is Vercel, which
   * is on UTC — so the stored instant would be 10:00Z, which is 15:35 IST.
   * Five and a half hours is nearly three times the two-hour target, so every
   * item would read as opened late. This test is the whole reason the helper
   * exists.
   */
  it("reads a zoneless local time as IST", () => {
    expect(wallClockIST("2026-11-16T10:00").toISOString()).toBe("2026-11-16T04:30:00.000Z");
  });

  it("accepts an optional seconds component", () => {
    expect(wallClockIST("2026-11-16T10:00:45").toISOString()).toBe(
      "2026-11-16T04:30:45.000Z",
    );
  });

  it("refuses anything that is not a local date and time", () => {
    expect(() => wallClockIST("2026-11-16")).toThrow();
    expect(() => wallClockIST("16/11/2026 10:00")).toThrow();
    expect(() => wallClockIST("")).toThrow();
  });

  it("round-trips its own default", () => {
    // nowISTLocalInput feeds the form; wallClockIST reads it back. Within a
    // minute of now, since the input has minute precision.
    const parsed = wallClockIST(nowISTLocalInput()).getTime();
    expect(Math.abs(parsed - Date.now())).toBeLessThan(61_000);
  });
});

/* -------------------------------------------------------------------------- */

describe("confirmation validation", () => {
  const valid = {
    confirmationSource: "PO",
    confirmedBy: "5b1dcbb7-3f0e-4bd4-9a32-5b2a2a4bfa01",
    confirmedAt: "2026-11-16T10:00",
  };

  it("accepts a complete confirmation", () => {
    expect(poItemConfirmationSchema.safeParse(valid).success).toBe(true);
  });

  it("requires all three", () => {
    for (const key of Object.keys(valid)) {
      const partial = { ...valid, [key]: "" };
      expect(poItemConfirmationSchema.safeParse(partial).success).toBe(false);
    }
  });

  /*
   * A future confirmation would be clamped to zero working minutes by the SQL
   * and therefore score as perfect. Refusing it here means a typo reaches a
   * person instead of the metric.
   */
  it("refuses a confirmation dated in the future", () => {
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16);
    const result = poItemConfirmationSchema.safeParse({ ...valid, confirmedAt: tomorrow });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain("future");
    }
  });

  /*
   * EDITING AN ITEM MUST NOT RESTATE ITS CONFIRMATION. poItemSchema is shared
   * by add and edit; if the confirmation lived in it, every correction to a
   * quantity would rewrite when the customer confirmed, and the measure would
   * drift towards zero as rows were touched.
   */
  it("is absent from the schema the edit form uses", () => {
    const result = poItemSchema.safeParse({
      itemName: "Edited carton",
      orderedQty: 500,
      committedDate: "2026-12-01",
      jobType: "New",
      priority: "Normal",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("confirmationSource");
      expect(result.data).not.toHaveProperty("confirmedAt");
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the dashboard tile", () => {
  /*
   * The tile's whole job is to keep three populations apart: scored and on
   * time, scored and late, and NOT SCORED. Folding the third into the second
   * is the mistake that would make the number useless, because on the day
   * this shipped every row in the company was in the third group.
   */
  it("counts an unconfirmed item as unrecorded, never as late", async () => {
    await inRollback(async (tx) => {
      const before = await jobOpening(tx);
      await makeItem(tx, null);
      const after = await jobOpening(tx);

      expect(after.unrecorded).toBe(before.unrecorded + 1);
      expect(after.late).toBe(before.late);
      expect(after.scored).toBe(before.scored);
    });
  });

  it("counts a just-confirmed item as scored and on time", async () => {
    await inRollback(async (tx) => {
      const before = await jobOpening(tx);
      await makeItem(tx, { source: "PO", at: new Date(Date.now() - 60_000).toISOString() });
      const after = await jobOpening(tx);

      expect(after.scored).toBe(before.scored + 1);
      expect(after.onTime).toBe(before.onTime + 1);
      expect(after.late).toBe(before.late);
    });
  });

  it("counts an item confirmed days ago as scored and late", async () => {
    await inRollback(async (tx) => {
      const before = await jobOpening(tx);
      await makeItem(tx, {
        source: "Verbal",
        at: new Date(Date.now() - 4 * 24 * 3600_000).toISOString(),
      });
      const after = await jobOpening(tx);

      expect(after.scored).toBe(before.scored + 1);
      expect(after.late).toBe(before.late + 1);
      expect(after.onTime).toBe(before.onTime);
    });
  });

  /*
   * NO PERCENTAGE RATHER THAN ZERO PERCENT, the same rule the OTD tile
   * follows: 0% of nothing reads as total failure to anybody glancing at it.
   */
  it("reports null, not zero, when nothing in the window is scored", async () => {
    const result = await jobOpening();
    if (result.scored === 0) expect(result.onTimePct).toBeNull();
    else expect(result.onTimePct).not.toBeNull();
  });

  it("reads its target from the setting", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`
        insert into app_setting (key, value) values ('job_open_target_working_minutes', '240')
        on conflict (key) do update set value = '240'
      `);
      await makeItem(tx, { source: "PO", at: new Date().toISOString() });
      expect((await jobOpening(tx)).targetWorkingMinutes).toBe(240);
    });
  });
});
