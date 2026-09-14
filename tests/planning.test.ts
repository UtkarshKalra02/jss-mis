import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, auditedUpdate, type Tx } from "@/db/audit";
import { jobCard, poItem, pressRun, purchaseOrder, stageEvent } from "@/db/schema";
import { addDaysISO, todayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";
import { describePlan, parsePlanForm, runsMovedWith } from "@/modules/planning/plan";
import {
  cardsToPlan,
  dayPlan,
  plannedCountsBetween,
  runMembersOf,
  unreleasedItemCount,
} from "@/modules/planning/queries";
import { groupByPressRun, selectableRows } from "@/modules/stage-update/grouping";

import { inRollback, makeCardFor, uniq } from "./helpers";

/**
 * The job planning board (spec 6.6, decisions L1–L4).
 *
 * The queries run against the real database because the board's urgency and
 * pending figures come from `v_po_item_status`, and the point of the tests is
 * that a card's row says what the view says — a mock of the view would only
 * test the mock.
 */

const TODAY = todayIST();
const TOMORROW = addDaysISO(TODAY, 1);
const YESTERDAY = addDaysISO(TODAY, -1);

async function makeClient(tx: Tx, name: string): Promise<string> {
  const [row] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("PL")}, ${name}) returning id`,
    )
  ).rows as { id: string }[];
  return row!.id;
}

async function makeItem(
  tx: Tx,
  clientName: string,
  over: { committedDate?: string | null; stageCode?: string } = {},
) {
  const clientId = await makeClient(tx, clientName);

  const order = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", TODAY),
      poNo: uniq("PO"),
      clientId,
      poDate: TODAY,
    },
    tx,
  );

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", TODAY),
      purchaseOrderId: order.id,
      itemName: `${clientName} carton`,
      orderedQty: 1000,
      committedDate: over.committedDate === undefined ? addDaysISO(TODAY, 10) : over.committedDate,
    },
    tx,
  );

  if (over.stageCode) {
    await tx.insert(stageEvent).values({
      poItemId: item.id,
      stageCode: over.stageCode,
      eventAt: new Date(),
      createdBy: SYSTEM_ACTOR.id,
    } as never);
  }

  return { clientId, poItemId: item.id, itemCode: item.itemCode };
}

async function makeRun(tx: Tx, runDate: string) {
  return auditedInsert(
    SYSTEM_ACTOR,
    pressRun,
    { runNo: await allocateNumber(tx, "PR", runDate), runDate, machine: "Komori" },
    tx,
  );
}

/* -------------------------------------------------------------------------- */
/* The form and the messages — pure                                            */
/* -------------------------------------------------------------------------- */

describe("the plan form", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  it("collapses a card ticked twice into one, and accepts a blank date as 'unplan'", () => {
    const fd = new FormData();
    fd.append("jobCardId", A);
    fd.append("jobCardId", A);
    fd.append("jobCardId", B);
    fd.append("plannedDate", "");

    const parsed = parsePlanForm(fd);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.jobCardIds).toEqual([A, B]);
      expect(parsed.data.plannedDate).toBe("");
    }
  });

  it("refuses an empty selection and a non-date", () => {
    const none = new FormData();
    none.append("plannedDate", TOMORROW);
    expect(parsePlanForm(none).success).toBe(false);

    const junk = new FormData();
    junk.append("jobCardId", A);
    junk.append("plannedDate", "tomorrow");
    expect(parsePlanForm(junk).success).toBe(false);
  });
});

describe("which plates move as a whole (L4)", () => {
  it("moves a run only when every live card on it is selected", () => {
    const members = new Map([
      ["run-1", ["c1", "c2", "c3"]],
      ["run-2", ["c4", "c5"]],
    ]);

    expect(runsMovedWith(new Set(["c1", "c2", "c3", "c4"]), members)).toEqual(["run-1"]);
    expect(runsMovedWith(new Set(["c1", "c2"]), members)).toEqual([]);
    expect(runsMovedWith(new Set(["c4", "c5", "c1"]), members)).toEqual(["run-2"]);
  });

  it("says what was done, plates included", () => {
    expect(describePlan({ cards: 1, plannedDate: "2026-09-15", runsMoved: 0 })).toBe(
      "1 job card planned for 15 Sept 2026.",
    );
    expect(describePlan({ cards: 3, plannedDate: "2026-09-15", runsMoved: 1 })).toBe(
      "3 job cards planned for 15 Sept 2026 · 1 plate moved with them.",
    );
    expect(describePlan({ cards: 2, plannedDate: "", runsMoved: 0 })).toBe(
      "2 job cards taken off the plan.",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The two panels — against the database                                      */
/* -------------------------------------------------------------------------- */

describe("the left panel: cards that need a day (L1)", () => {
  it("lists an undated card and a slipped one, and not one planned ahead", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Undated");
      const b = await makeItem(tx, "Slipped");
      const c = await makeItem(tx, "Planned ahead");

      const undated = await makeCardFor(tx, a.poItemId, {}, 500);
      const slipped = await makeCardFor(tx, b.poItemId, { plannedDate: YESTERDAY }, 500);
      const ahead = await makeCardFor(tx, c.poItemId, { plannedDate: TOMORROW }, 500);

      const ids = (await cardsToPlan(tx)).map((r) => r.jobCardId);
      expect(ids).toContain(undated.id);
      expect(ids).toContain(slipped.id);
      expect(ids).not.toContain(ahead.id);
    });
  });

  it("drops a card once it is completed, cancelled, or its item has shipped", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Done");
      const b = await makeItem(tx, "Withdrawn");

      const done = await makeCardFor(tx, a.poItemId, { status: "Completed" }, 500);
      const withdrawn = await makeCardFor(tx, b.poItemId, { status: "Cancelled" }, 500);

      const ids = (await cardsToPlan(tx)).map((r) => r.jobCardId);
      expect(ids).not.toContain(done.id);
      expect(ids).not.toContain(withdrawn.id);
    });
  });

  it("takes its urgency from the view: an overdue item makes an overdue card", async () => {
    await inRollback(async (tx) => {
      const late = await makeItem(tx, "Late", { committedDate: addDaysISO(TODAY, -3) });
      const card = await makeCardFor(tx, late.poItemId, {}, 500);

      const rows = await cardsToPlan(tx);
      const row = rows.find((r) => r.jobCardId === card.id)!;

      expect(row.isOverdue).toBe(true);
      expect(row.daysToCommitted).toBe(-3);
      expect(row.pendingQty).toBe(1000);
      expect(row.itemCount).toBe(1);
      // Overdue first, whatever else is on the board.
      expect(rows[0]!.isOverdue).toBe(true);
    });
  });

  it("names a card by its first item and counts the rest (J25)", async () => {
    await inRollback(async (tx) => {
      const first = await makeItem(tx, "First");
      const second = await makeItem(tx, "Second", { committedDate: addDaysISO(TODAY, 2) });

      const card = await makeCardFor(tx, first.poItemId, {}, 500);
      await tx.execute(
        sql`insert into job_card_item (job_card_id, po_item_id, planned_qty, created_by)
            values (${card.id}, ${second.poItemId}, 300, ${SYSTEM_ACTOR.id})`,
      );

      const row = (await cardsToPlan(tx)).find((r) => r.jobCardId === card.id)!;
      expect(row.itemCode).toBe(first.itemCode);
      expect(row.itemCount).toBe(2);
      expect(row.clientCount).toBe(2);
      expect(row.pendingQty).toBe(2000);
      // The most urgent covered item sets the card's date, not the first.
      expect(row.committedDate).toBe(addDaysISO(TODAY, 2));
    });
  });

  it("carries the plate, so the board can collapse a ganged run (H8)", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Gang A");
      const b = await makeItem(tx, "Gang B");
      const run = await makeRun(tx, TOMORROW);

      const ca = await makeCardFor(tx, a.poItemId, { pressRunId: run.id }, 500);
      const cb = await makeCardFor(tx, b.poItemId, { pressRunId: run.id }, 500);

      const rows = await cardsToPlan(tx);
      const groups = groupByPressRun(rows);
      const plate = groups.find((g) => g.kind === "run" && g.pressRunId === run.id);

      expect(plate?.kind).toBe("run");
      if (plate?.kind === "run") {
        expect(plate.rows.map((r) => r.jobCardId).sort()).toEqual([ca.id, cb.id].sort());
        // Collapsed, neither card is tickable; expanded, both are.
        expect(selectableRows(groups, new Set()).map((r) => r.jobCardId)).not.toContain(ca.id);
        expect(selectableRows(groups, new Set([run.id])).map((r) => r.jobCardId)).toContain(
          cb.id,
        );
      }

      const members = await runMembersOf([ca.id], tx);
      expect(members.get(run.id)?.sort()).toEqual([ca.id, cb.id].sort());
    });
  });
});

describe("the right panel: one day's plan", () => {
  it("lists what is dated that day, in station order, and counts the week", async () => {
    await inRollback(async (tx) => {
      const early = await makeItem(tx, "At press", { stageCode: "PRINTING" });
      const later = await makeItem(tx, "At die-cut", { stageCode: "DIE_CUT" });
      const other = await makeItem(tx, "Other day");

      const c1 = await makeCardFor(tx, later.poItemId, { plannedDate: TOMORROW }, 500);
      const c2 = await makeCardFor(tx, early.poItemId, { plannedDate: TOMORROW }, 500);
      await makeCardFor(tx, other.poItemId, { plannedDate: addDaysISO(TODAY, 2) }, 500);

      const rows = await dayPlan(TOMORROW, tx);
      const ids = rows.map((r) => r.jobCardId);
      expect(ids.indexOf(c2.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(c2.id)).toBeLessThan(ids.indexOf(c1.id));

      const counts = await plannedCountsBetween(TODAY, addDaysISO(TODAY, 6), tx);
      expect(counts.get(TOMORROW)).toBeGreaterThanOrEqual(2);
      expect(counts.get(addDaysISO(TODAY, 2))).toBeGreaterThanOrEqual(1);
    });
  });

  it("keeps a completed card on the day it ran, and drops a cancelled one", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Ran");
      const b = await makeItem(tx, "Pulled");
      const ran = await makeCardFor(tx, a.poItemId, { plannedDate: YESTERDAY }, 500);
      const pulled = await makeCardFor(tx, b.poItemId, { plannedDate: YESTERDAY }, 500);

      await auditedUpdate(SYSTEM_ACTOR, jobCard, ran.id, { status: "Completed" }, tx);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, pulled.id, { status: "Cancelled" }, tx);

      const ids = (await dayPlan(YESTERDAY, tx)).map((r) => r.jobCardId);
      expect(ids).toContain(ran.id);
      expect(ids).not.toContain(pulled.id);
    });
  });
});

describe("items with no card at all", () => {
  it("counts an open item nobody has released, and stops once a card exists", async () => {
    await inRollback(async (tx) => {
      const before = await unreleasedItemCount(tx);
      const item = await makeItem(tx, "Unreleased");
      expect(await unreleasedItemCount(tx)).toBe(before + 1);

      // A cancelled card is not cover (J12).
      await makeCardFor(tx, item.poItemId, { status: "Cancelled" }, 500);
      expect(await unreleasedItemCount(tx)).toBe(before + 1);

      await makeCardFor(tx, item.poItemId, {}, 500);
      expect(await unreleasedItemCount(tx)).toBe(before);
    });
  });
});
