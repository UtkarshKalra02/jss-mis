import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, auditedSoftDelete, auditedUpdate, type Actor, type Tx } from "@/db/audit";
import { poItem, purchaseOrder } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";
import { addDaysISO, todayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";
import { manualCloseFence } from "@/modules/purchase-orders/queries";
import { closeReasonSchema } from "@/modules/purchase-orders/validation";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Manual job close — section X, migration 0048.
 *
 * THE TEST THIS FILE EXISTS FOR is "a manual close survives a recompute".
 * po_item.status is derived from dispatch quantities on every dispatch edit and
 * again nightly; the recompute returns early for 'Cancelled' and nothing else.
 * Had 0048 not taught it about the manual-close columns, a closed job would
 * have reverted to Open overnight and nobody would have seen it happen. That is
 * pinned below and it is the reason the other tests matter.
 *
 * Dates are computed from today_ist() rather than written as literals, because
 * the fence is "N days after the PO date" measured against the current date —
 * a fixed PO date would make this file go red once it aged past the window.
 */

const REASON = "Client confirmed on call they do not want the balance — season over.";

/** A PO dated `daysAgo` days back, and one open item on it. */
async function makeItem(tx: Tx, daysAgo: number, orderedQty = 1000) {
  const poDate = addDaysISO(todayIST(), -daysAgo);

  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("MC")}, 'Manual Close Co') returning id`,
    )
  ).rows as { id: string }[];

  const order = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", poDate),
      clientId: c!.id,
      poDate,
    },
    tx,
  );

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", poDate),
      purchaseOrderId: order.id,
      itemName: "Manual close test carton",
      orderedQty,
      committedDate: addDaysISO(poDate, 14),
    },
    tx,
  );

  return { item, order, poDate };
}

/** An app_user to attribute a close to, in the given role. */
async function makeUser(tx: Tx, role: string): Promise<Actor> {
  const [row] = (
    await tx.execute(
      sql`insert into app_user (username, name, role, is_active)
          values (${uniq("u")}, 'Close Tester', ${sql.raw(`'${role}'::user_role`)}, true)
          returning id`,
    )
  ).rows as { id: string }[];

  return { id: row!.id, role: role as Actor["role"] };
}

function closeValues(actorId: string, reason = REASON) {
  return { closedManuallyAt: new Date(), closedBy: actorId, closeReason: reason };
}

const REOPEN = { closedManuallyAt: null, closedBy: null, closeReason: null };

async function statusOf(tx: Tx, id: string): Promise<string> {
  const r = await tx.execute(sql`select status from po_item where id = ${id}`);
  return (r.rows[0] as { status: string }).status;
}

async function recompute(tx: Tx, id: string) {
  await tx.execute(sql`select recompute_for_po_item(${id}::uuid)`);
}

async function setMinDays(tx: Tx, days: number) {
  await tx.execute(
    sql`update app_setting set value = ${String(days)}
        where key = 'manual_close_min_days_after_po'`,
  );
}

/* -------------------------------------------------------------------------- */

describe("the waiting period after the PO date", () => {
  it("allows a close once the job is old enough", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);

      const r = await tx.execute(
        sql`select close_reason, closed_by from po_item where id = ${item.id}`,
      );
      expect((r.rows[0] as { close_reason: string }).close_reason).toBe(REASON);
    });
  });

  it("refuses a close on a job raised today", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 0);
      const actor = await makeUser(tx, "ADMIN");

      const { threw, message } = await expectFailure(tx, (sp) =>
        auditedUpdate(actor, poItem, item.id, closeValues(actor.id), sp),
      );

      expect(threw).toBe(true);
      expect(message).toContain("cannot be closed by hand until");
    });
  });

  it("refuses one day short of the window, and allows it exactly on the day", async () => {
    await inRollback(async (tx) => {
      const actor = await makeUser(tx, "ADMIN");

      const early = await makeItem(tx, 29);
      const refused = await expectFailure(tx, (sp) =>
        auditedUpdate(actor, poItem, early.item.id, closeValues(actor.id), sp),
      );
      expect(refused.threw).toBe(true);

      const onTheDay = await makeItem(tx, 30);
      await auditedUpdate(actor, poItem, onTheDay.item.id, closeValues(actor.id), tx);
      expect(await statusOf(tx, onTheDay.item.id)).toBe("Closed");
    });
  });

  it("reads the window from app_setting, so shortening it takes effect at once", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 10);
      const actor = await makeUser(tx, "ADMIN");

      const refused = await expectFailure(tx, (sp) =>
        auditedUpdate(actor, poItem, item.id, closeValues(actor.id), sp),
      );
      expect(refused.threw).toBe(true);

      await setMinDays(tx, 5);
      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);
      expect(await statusOf(tx, item.id)).toBe("Closed");
    });
  });

  it("never fences a reopen", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);
      // Shrinking the PO's age would refuse a fresh close; the reopen is unaffected.
      await setMinDays(tx, 365);
      await auditedUpdate(actor, poItem, item.id, REOPEN, tx);

      await recompute(tx, item.id);
      expect(await statusOf(tx, item.id)).toBe("Open");
    });
  });

  it("refuses a job created already closed", async () => {
    await inRollback(async (tx) => {
      const { order } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      const { threw, message } = await expectFailure(tx, (sp) =>
        auditedInsert(
          actor,
          poItem,
          {
            itemCode: uniq("ITM"),
            purchaseOrderId: order.id,
            itemName: "Born closed",
            orderedQty: 10,
            ...closeValues(actor.id),
          } as never,
          sp,
        ),
      );

      expect(threw).toBe(true);
      expect(message).toContain("cannot be created already closed");
    });
  });
});

describe("the three columns travel together", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["the time alone", { closedManuallyAt: new Date() }],
    ["the closer alone", { closedBy: null }],
    ["the reason alone", { closeReason: REASON }],
  ];

  for (const [label, partial] of cases) {
    it(`refuses ${label}`, async () => {
      await inRollback(async (tx) => {
        const { item } = await makeItem(tx, 40);
        const actor = await makeUser(tx, "ADMIN");
        const values = label === "the closer alone" ? { closedBy: actor.id } : partial;

        const { threw, message } = await expectFailure(tx, (sp) =>
          auditedUpdate(actor, poItem, item.id, values as never, sp),
        );

        expect(threw).toBe(true);
        expect(message).toContain("po_item_manual_close_all_or_none");
      });
    });
  }

  it("refuses a reason that is only whitespace", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      const { threw, message } = await expectFailure(tx, (sp) =>
        auditedUpdate(actor, poItem, item.id, closeValues(actor.id, "   "), sp),
      );

      expect(threw).toBe(true);
      expect(message).toContain("po_item_close_reason_not_blank");
    });
  });
});

describe("the recompute respects a manual close", () => {
  it("derives Closed although nothing was dispatched", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      expect(await statusOf(tx, item.id)).toBe("Open");
      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);
      expect(await statusOf(tx, item.id)).toBe("Closed");
    });
  });

  /**
   * THE REGRESSION THIS FEATURE TURNS ON. Before 0048 taught the recompute
   * about these columns, this is the assertion that would have failed — and it
   * would have failed overnight, in production, silently.
   */
  it("does not flip the job back to Open when run again", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);

      await recompute(tx, item.id);
      await recompute(tx, item.id);

      expect(await statusOf(tx, item.id)).toBe("Closed");
    });
  });

  it("settles back on the derived answer after a reopen", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);
      expect(await statusOf(tx, item.id)).toBe("Closed");

      await auditedUpdate(actor, poItem, item.id, REOPEN, tx);
      expect(await statusOf(tx, item.id)).toBe("Open");
    });
  });

  it("records the reason on the status audit row", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);

      const r = await tx.execute(
        sql`select after from audit_log
            where table_name = 'po_item' and record_id = ${item.id}
              and after->>'reason' = 'manually_closed'`,
      );
      expect(r.rows.length).toBe(1);
    });
  });

  it("leaves a cancelled job cancelled", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const actor = await makeUser(tx, "ADMIN");

      await tx.execute(sql`select set_config('jss.allow_status_write', 'on', true)`);
      await tx.execute(sql`update po_item set status = 'Cancelled' where id = ${item.id}`);
      await tx.execute(sql`select set_config('jss.allow_status_write', 'off', true)`);

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);
      await recompute(tx, item.id);

      expect(await statusOf(tx, item.id)).toBe("Cancelled");
    });
  });
});

describe("the fourth exception to B2 — an OWNER closing a job", () => {
  it("lets an OWNER close a job in his own name", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const owner = await makeUser(tx, "OWNER");

      await auditedUpdate(owner, poItem, item.id, closeValues(owner.id), tx);
      expect(await statusOf(tx, item.id)).toBe("Closed");
    });
  });

  it("lets an OWNER reopen a job", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const owner = await makeUser(tx, "OWNER");

      await auditedUpdate(owner, poItem, item.id, closeValues(owner.id), tx);
      await auditedUpdate(owner, poItem, item.id, REOPEN, tx);

      expect(await statusOf(tx, item.id)).toBe("Open");
    });
  });

  it("refuses an OWNER recording somebody else as the closer", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const owner = await makeUser(tx, "OWNER");
      const someoneElse = await makeUser(tx, "ADMIN");

      const { threw, message } = await expectFailure(tx, (sp) =>
        auditedUpdate(owner, poItem, item.id, closeValues(someoneElse.id), sp),
      );

      expect(threw).toBe(true);
      expect(message).toContain("read-only");
    });
  });

  it("refuses an OWNER smuggling another field into the same update", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const owner = await makeUser(tx, "OWNER");

      const { threw } = await expectFailure(tx, (sp) =>
        auditedUpdate(
          owner,
          poItem,
          item.id,
          { ...closeValues(owner.id), orderedQty: 1 } as never,
          sp,
        ),
      );

      expect(threw).toBe(true);
    });
  });

  it("still refuses an OWNER every other write on po_item", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 40);
      const owner = await makeUser(tx, "OWNER");

      const edit = await expectFailure(tx, (sp) =>
        auditedUpdate(owner, poItem, item.id, { itemName: "Renamed" } as never, sp),
      );
      expect(edit.threw).toBe(true);

      const remove = await expectFailure(tx, (sp) =>
        auditedSoftDelete(owner, poItem, item.id, sp),
      );
      expect(remove.threw).toBe(true);
    });
  });
});

describe("the reason a person has to type", () => {
  it("refuses blank, whitespace and a token word", () => {
    for (const reason of ["", "   ", "ok", "done", "-"]) {
      expect(closeReasonSchema.safeParse({ reason }).success).toBe(false);
    }
  });

  it("accepts a sentence, trimmed", () => {
    const parsed = closeReasonSchema.safeParse({ reason: `  ${REASON}  ` });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe(REASON);
  });
});

/* -------------------------------------------------------------------------- */
/* OTD sees a job closed by hand — section AA                                 */
/* -------------------------------------------------------------------------- */

/** One dispatched challan against an item, on a given date. */
async function dispatchSome(tx: Tx, itemId: string, qty: number, on: string) {
  const [d] = (
    await tx.execute(
      sql`insert into dispatch (challan_no, client_id, dispatch_date, status)
          select ${uniq("CH")}, po.client_id, ${on}::date, 'Dispatched'
          from po_item pi join purchase_order po on po.id = pi.purchase_order_id
          where pi.id = ${itemId}
          returning id`,
    )
  ).rows as { id: string }[];

  await tx.execute(
    sql`insert into dispatch_line (dispatch_id, po_item_id, qty)
        values (${d!.id}, ${itemId}, ${qty})`,
  );
}

async function otdRow(tx: Tx, itemId: string) {
  const r = await tx.execute(
    sql`select on_time, days_late, fulfilment_date, ordered_qty
        from v_otd where po_item_id = ${itemId}`,
  );
  return (r.rows[0] ?? null) as
    | { on_time: boolean; days_late: number; fulfilment_date: string; ordered_qty: number }
    | null;
}

/** An item whose PO is old enough to close, with a committed date in the past. */
async function closableItem(tx: Tx, orderedQty = 10_000) {
  const made = await makeItem(tx, 90, orderedQty);
  await tx.execute(
    sql`update po_item set committed_date = (today_ist() - 60) where id = ${made.item.id}`,
  );
  return made;
}

describe("OTD counts a job closed by hand", () => {
  /**
   * THE GENUINE EXPLOIT THIS CLOSES. v_otd demanded dispatched_qty > 0, so a
   * job closed with nothing delivered was absent from the measure altogether —
   * close it before the first challan and OTD never knew it existed.
   */
  it("admits a job closed with NOTHING dispatched, and scores it late", async () => {
    await inRollback(async (tx) => {
      const { item } = await closableItem(tx);
      const actor = await makeUser(tx, "ADMIN");

      expect(await otdRow(tx, item.id)).toBeNull();

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);

      const row = await otdRow(tx, item.id);
      expect(row).not.toBeNull();
      expect(row!.on_time).toBe(false);
    });
  });

  /**
   * THE FALSE SUCCESS THIS REMOVES. on_time was
   * last_dispatch_date <= committed_date, so sending most of an order before
   * the promised date and short-closing the rest counted as delivered on time.
   */
  it("refuses to call a short close on time, even when the part delivered was early", async () => {
    await inRollback(async (tx) => {
      const { item } = await closableItem(tx, 10_000);
      const actor = await makeUser(tx, "ADMIN");

      // 9,000 of 10,000, delivered well before the committed date.
      const early = (
        await tx.execute(sql`select (today_ist() - 70)::text as d`)
      ).rows[0] as { d: string };
      await dispatchSome(tx, item.id, 9_000, early.d);

      // Before the close it is in v_otd and reads ON TIME — the old answer.
      const before = await otdRow(tx, item.id);
      expect(before).not.toBeNull();
      expect(before!.on_time).toBe(true);

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);

      const after = await otdRow(tx, item.id);
      expect(after!.on_time).toBe(false);
    });
  });

  it("dates the ending at the day it was closed, not the last partial delivery", async () => {
    await inRollback(async (tx) => {
      const { item } = await closableItem(tx);
      const actor = await makeUser(tx, "ADMIN");

      const early = (
        await tx.execute(sql`select (today_ist() - 70)::text as d`)
      ).rows[0] as { d: string };
      await dispatchSome(tx, item.id, 1_000, early.d);
      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);

      const today = (await tx.execute(sql`select today_ist()::text as d`)).rows[0] as {
        d: string;
      };
      const row = await otdRow(tx, item.id);

      expect(row!.fulfilment_date).toBe(today.d);
      // Committed 60 days ago, settled today.
      expect(row!.days_late).toBe(60);
    });
  });

  /** A fully delivered item is scored exactly as it always was. */
  it("leaves a completed item's scoring untouched", async () => {
    await inRollback(async (tx) => {
      const { item } = await closableItem(tx, 1_000);

      const early = (
        await tx.execute(sql`select (today_ist() - 70)::text as d`)
      ).rows[0] as { d: string };
      await dispatchSome(tx, item.id, 1_000, early.d);

      const row = await otdRow(tx, item.id);
      expect(row!.on_time).toBe(true);
      expect(row!.fulfilment_date).toBe(early.d);
    });
  });

  /**
   * F8 is kept: no promise, nothing to be late against. A short close must not
   * invent a commitment that was never made.
   */
  it("still excludes an item with no committed date", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 90);
      await tx.execute(
        sql`update po_item set committed_date = null where id = ${item.id}`,
      );
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);
      expect(await otdRow(tx, item.id)).toBeNull();
    });
  });

  /** Reopening puts the measure back where it was. */
  it("drops out of OTD again when the job is reopened", async () => {
    await inRollback(async (tx) => {
      const { item } = await closableItem(tx);
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);
      expect(await otdRow(tx, item.id)).not.toBeNull();

      await auditedUpdate(actor, poItem, item.id, REOPEN, tx);
      expect(await otdRow(tx, item.id)).toBeNull();
    });
  });

  /**
   * The T1 auto-close keeps the scoring it has always had. It is a different
   * rule, deliberately fenced, and rescoring it here would rewrite history for
   * orders already retired under a rule nobody changed. Told apart by
   * closed_manually_at, which only a person's close sets.
   */
  it("does not change how a T1 auto-closed residual is scored", async () => {
    await inRollback(async (tx) => {
      const { item } = await closableItem(tx, 10_000);

      const early = (
        await tx.execute(sql`select (today_ist() - 70)::text as d`)
      ).rows[0] as { d: string };
      // 9,000 out early; 1,000 residual, under the 1,500 threshold, on a
      // commitment whose month has passed — T1 closes it by itself.
      await dispatchSome(tx, item.id, 9_000, early.d);
      await recompute(tx, item.id);

      expect(await statusOf(tx, item.id)).toBe("Closed");

      const row = await otdRow(tx, item.id);
      expect(row).not.toBeNull();
      // Unchanged: scored against the last dispatch, which beat the promise.
      expect(row!.on_time).toBe(true);
      expect(row!.fulfilment_date).toBe(early.d);
    });
  });
});


/* -------------------------------------------------------------------------- */
/* The fence, asked from two screens — X9                                    */
/* -------------------------------------------------------------------------- */

/**
 * `manualCloseFence` is the fence as SQL, and section X said what matters
 * about it: the key must not drift from the lock. Since X9 three places ask
 * the question — the item's page, the tracker's row menu, and the action — and
 * two of them ask it over DIFFERENT relations: the order's `po_date` column and
 * `v_po_item_status`'s copy of it.
 *
 * So the invariant worth a test is not "is thirty days thirty days". It is
 * that the same item gets the same answer whichever relation the question was
 * asked over, including after somebody edits the setting — which is the case a
 * hand-written copy of the arithmetic on one screen would quietly fail.
 */
describe("the manual-close fence, over both relations it is asked over", () => {
  async function viaOrder(tx: Tx, itemId: string) {
    const f = manualCloseFence(purchaseOrder.poDate);
    const [row] = await tx
      .select({ minDays: f.minDays, earliest: f.earliest, eligible: f.eligible })
      .from(poItem)
      .innerJoin(purchaseOrder, eq(purchaseOrder.id, poItem.purchaseOrderId))
      .where(eq(poItem.id, itemId));
    return row!;
  }

  async function viaTracker(tx: Tx, itemId: string) {
    const f = manualCloseFence(vPoItemStatus.poDate);
    const [row] = await tx
      .select({ minDays: f.minDays, earliest: f.earliest, eligible: f.eligible })
      .from(vPoItemStatus)
      .where(eq(vPoItemStatus.poItemId, itemId));
    return row!;
  }

  it("agrees on a job too young to close", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 3);

      const order = await viaOrder(tx, item.id);
      expect(order.eligible).toBe(false);
      expect(await viaTracker(tx, item.id)).toEqual(order);
    });
  });

  it("agrees on a job old enough to close", async () => {
    await inRollback(async (tx) => {
      const { item, poDate } = await makeItem(tx, 60);

      const order = await viaOrder(tx, item.id);
      expect(order.eligible).toBe(true);
      // The date it names is the PO date plus the setting, not today.
      expect(order.earliest).toBe(addDaysISO(poDate, order.minDays));
      expect(await viaTracker(tx, item.id)).toEqual(order);
    });
  });

  it("still agrees after the waiting period is changed in Admin", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 45);

      // Eligible under the default thirty days.
      expect((await viaOrder(tx, item.id)).eligible).toBe(true);

      await setMinDays(tx, 90);

      const order = await viaOrder(tx, item.id);
      expect(order.minDays).toBe(90);
      expect(order.eligible).toBe(false);
      // Both read the setting, so neither can be left offering the button.
      expect(await viaTracker(tx, item.id)).toEqual(order);
    });
  });
});

/**
 * What the tracker's row menu reads to decide what to offer (X9).
 *
 * `status` says "Closed" for two different events, and only one of them can be
 * reopened: a person wrote off the balance, or the whole order went out.
 * `closed_manually_at` is the only thing that tells them apart, and the view
 * carries it for exactly this reason.
 */
describe("a person's close is distinguishable from a delivered one", () => {
  async function trackerRow(tx: Tx, itemId: string) {
    const [row] = await tx
      .select({
        status: vPoItemStatus.status,
        closedManuallyAt: vPoItemStatus.closedManuallyAt,
        pendingQty: vPoItemStatus.pendingQty,
      })
      .from(vPoItemStatus)
      .where(eq(vPoItemStatus.poItemId, itemId));
    return row!;
  }

  it("marks a job closed by hand, with the balance still owed", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 60, 1000);
      const actor = await makeUser(tx, "ADMIN");

      await auditedUpdate(actor, poItem, item.id, closeValues(actor.id), tx);

      const row = await trackerRow(tx, item.id);
      expect(row.status).toBe("Closed");
      expect(row.closedManuallyAt).not.toBeNull();
      // The write-off is still visible as quantity owed — the number the
      // dialog shows before anybody types a reason.
      expect(Number(row.pendingQty)).toBe(1000);
    });
  });

  it("leaves a fully delivered job unmarked, so the menu offers no reopen", async () => {
    await inRollback(async (tx) => {
      const { item } = await makeItem(tx, 60, 1000);

      const on = (await tx.execute(sql`select (today_ist() - 5)::text as d`)).rows[0] as {
        d: string;
      };
      await dispatchSome(tx, item.id, 1000, on.d);
      await recompute(tx, item.id);

      const row = await trackerRow(tx, item.id);
      expect(row.status).toBe("Closed");
      // Closed by delivery. Nothing to reopen and nothing to write off.
      expect(row.closedManuallyAt).toBeNull();
      expect(Number(row.pendingQty)).toBe(0);
    });
  });
});
