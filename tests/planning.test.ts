import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { dispatch, dispatchLine, planEntry, poItem, pressRun, purchaseOrder } from "@/db/schema";
import { addDaysISO, todayIST } from "@/lib/dates";
import { allocateNumber } from "@/lib/numbering";
import { groupByStation } from "@/modules/planning/floor-plan";
import {
  changedPositions,
  describeAdd,
  parseAddForm,
  reorder,
} from "@/modules/planning/plan";
import {
  dayPlan,
  dispatchPlanFor,
  itemsToPlan,
  nextPlannedDateFor,
  plannedCountsBetween,
  siblingsOf,
} from "@/modules/planning/queries";
import { groupByPressRun, selectableRows } from "@/modules/stage-update/grouping";

import { expectFailure, inRollback, makeCardFor, uniq } from "./helpers";

/**
 * The job planning board (spec 6.6, decisions M1–M3).
 *
 * The queries run against the real database because the board's urgency and
 * pending figures come from `v_po_item_status`, and the point is that a row
 * says what the view says. The check constraints on `plan_entry` are also
 * only real in Postgres.
 */

const TODAY = todayIST();
const TOMORROW = addDaysISO(TODAY, 1);

async function makeClient(tx: Tx, name: string): Promise<string> {
  const [row] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("PL")}, ${name}) returning id`,
    )
  ).rows as { id: string }[];
  return row!.id;
}

async function makeItem(tx: Tx, clientName: string, committedDate: string | null = addDaysISO(TODAY, 10)) {
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
      committedDate,
    },
    tx,
  );

  return { clientId, poItemId: item.id, itemCode: item.itemCode };
}

async function plan(
  tx: Tx,
  poItemId: string,
  over: Partial<{
    planDate: string;
    kind: "Production" | "Dispatch";
    stageCode: string | null;
    sequence: number;
    plannedQty: number | null;
  }> = {},
) {
  const kind = over.kind ?? "Production";
  return auditedInsert(
    SYSTEM_ACTOR,
    planEntry,
    {
      planDate: over.planDate ?? TOMORROW,
      poItemId,
      kind,
      stageCode: over.stageCode === undefined ? (kind === "Production" ? "PRINTING" : null) : over.stageCode,
      sequence: over.sequence ?? 1,
      plannedQty: over.plannedQty ?? null,
    },
    tx,
  );
}

/* -------------------------------------------------------------------------- */
/* Pure                                                                        */
/* -------------------------------------------------------------------------- */

describe("the add form", () => {
  const A = "11111111-1111-1111-1111-111111111111";

  it("needs a station for production and not for dispatch", () => {
    const prod = new FormData();
    prod.append("poItemId", A);
    prod.append("poItemId", A);
    prod.append("planDate", TOMORROW);
    prod.append("kind", "Production");
    prod.append("stageCode", "");
    expect(parseAddForm(prod).success).toBe(false);

    prod.set("stageCode", "PRINTING");
    const parsed = parseAddForm(prod);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.poItemIds).toEqual([A]);

    const disp = new FormData();
    disp.append("poItemId", A);
    disp.append("planDate", TOMORROW);
    disp.append("kind", "Dispatch");
    expect(parseAddForm(disp).success).toBe(true);
  });
});

describe("re-ordering the queue (M2)", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves one line and shifts the rest", () => {
    expect(reorder(ids, "c", "up")).toEqual(["a", "c", "b", "d"]);
    expect(reorder(ids, "b", "down")).toEqual(["a", "c", "b", "d"]);
    expect(reorder(ids, "d", "first")).toEqual(["d", "a", "b", "c"]);
    expect(reorder(ids, "a", "last")).toEqual(["b", "c", "d", "a"]);
  });

  it("is a no-op at the edges and for an unknown id", () => {
    expect(reorder(ids, "a", "up")).toEqual(ids);
    expect(reorder(ids, "d", "down")).toEqual(ids);
    expect(reorder(ids, "zz", "first")).toEqual(ids);
  });

  it("writes only the positions that changed, 1-based", () => {
    const after = reorder(ids, "d", "first");
    expect([...changedPositions(ids, after)]).toEqual([
      ["d", 1],
      ["a", 2],
      ["b", 3],
      ["c", 4],
    ]);
    expect(changedPositions(ids, reorder(ids, "c", "up")).size).toBe(2);
  });

  it("says what was added and what was already there", () => {
    expect(describeAdd({ added: 3, skipped: 0, kind: "Production", planDate: "2026-09-16" })).toBe(
      "3 items added to the 16 Sept 2026 production plan.",
    );
    expect(describeAdd({ added: 1, skipped: 1, kind: "Dispatch", planDate: "2026-09-16" })).toBe(
      "1 item added to the 16 Sept 2026 dispatch list · 1 was already on it.",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Against the database                                                        */
/* -------------------------------------------------------------------------- */

describe("the left panel: open items, cards or not (M1)", () => {
  it("lists an item with no card, and shows the card when there is one", async () => {
    await inRollback(async (tx) => {
      const bare = await makeItem(tx, "No card yet");
      const carded = await makeItem(tx, "Has card");
      const card = await makeCardFor(tx, carded.poItemId, {}, 500);

      const rows = await itemsToPlan(tx);
      const a = rows.find((r) => r.poItemId === bare.poItemId)!;
      const b = rows.find((r) => r.poItemId === carded.poItemId)!;

      expect(a.jcNo).toBeNull();
      expect(b.jcNo).toBe(card.jcNo);
      expect(a.pendingQty).toBe(1000);
    });
  });

  it("says which days an item is already planned on, from today forward", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, "Planned twice");
      await plan(tx, item.poItemId, { planDate: TOMORROW });
      await plan(tx, item.poItemId, { planDate: addDaysISO(TODAY, 3), stageCode: "LAMINATION" });
      await plan(tx, item.poItemId, { planDate: addDaysISO(TODAY, -2) }); // history
      await plan(tx, item.poItemId, { planDate: TOMORROW, kind: "Dispatch", plannedQty: 1000 });

      const row = (await itemsToPlan(tx)).find((r) => r.poItemId === item.poItemId)!;
      expect(row.productionDates).toEqual([TOMORROW, addDaysISO(TODAY, 3)]);
      expect(row.dispatchDates).toEqual([TOMORROW]);
    });
  });

  it("puts the most urgent first, and carries the plate so a run collapses (H8)", async () => {
    await inRollback(async (tx) => {
      const late = await makeItem(tx, "Late", addDaysISO(TODAY, -3));
      const a = await makeItem(tx, "Gang A");
      const b = await makeItem(tx, "Gang B");
      const run = await auditedInsert(
        SYSTEM_ACTOR,
        pressRun,
        { runNo: await allocateNumber(tx, "PR", TOMORROW), runDate: TOMORROW, machine: "Komori" },
        tx,
      );
      await makeCardFor(tx, a.poItemId, { pressRunId: run.id }, 500);
      await makeCardFor(tx, b.poItemId, { pressRunId: run.id }, 500);

      const rows = await itemsToPlan(tx);
      expect(rows[0]!.isOverdue).toBe(true);
      expect(rows.find((r) => r.poItemId === late.poItemId)!.daysToCommitted).toBe(-3);

      const groups = groupByPressRun(rows);
      const plate = groups.find((g) => g.kind === "run" && g.pressRunId === run.id);
      expect(plate?.kind).toBe("run");
      expect(selectableRows(groups, new Set()).map((r) => r.poItemId)).not.toContain(a.poItemId);
      expect(selectableRows(groups, new Set([run.id])).map((r) => r.poItemId)).toContain(
        b.poItemId,
      );
    });
  });
});

describe("one day's plan", () => {
  it("comes back by station in stage order, then the meeting's order, dispatch last", async () => {
    await inRollback(async (tx) => {
      const x = await makeItem(tx, "X");
      const y = await makeItem(tx, "Y");
      const z = await makeItem(tx, "Z");

      await plan(tx, x.poItemId, { stageCode: "DIE_CUT", sequence: 1 });
      await plan(tx, y.poItemId, { stageCode: "PRINTING", sequence: 2 });
      await plan(tx, z.poItemId, { stageCode: "PRINTING", sequence: 1 });
      await plan(tx, x.poItemId, { kind: "Dispatch", plannedQty: 400 });

      const rows = (await dayPlan(TOMORROW, tx)).filter((r) =>
        [x.poItemId, y.poItemId, z.poItemId].includes(r.poItemId),
      );
      expect(rows.map((r) => `${r.kind}:${r.stageCode ?? "-"}:${r.itemName}`)).toEqual([
        "Production:PRINTING:Z carton",
        "Production:PRINTING:Y carton",
        "Production:DIE_CUT:X carton",
        "Dispatch:-:X carton",
      ]);

      const stations = groupByStation(rows);
      expect(stations.map((s) => s.key)).toEqual(["PRINTING", "DIE_CUT", "DISPATCH"]);
      expect(stations[2]!.pendingQty).toBe(400);

      const counts = await plannedCountsBetween(TODAY, addDaysISO(TODAY, 6), tx);
      expect(counts.get(TOMORROW)!.production).toBeGreaterThanOrEqual(3);
      expect(counts.get(TOMORROW)!.dispatch).toBeGreaterThanOrEqual(1);

      expect(await nextPlannedDateFor(x.poItemId, tx)).toBe(TOMORROW);
      expect((await siblingsOf(TOMORROW, "Production", tx)).length).toBeGreaterThanOrEqual(3);
    });
  });

  it("refuses a production line with no station, and a dispatch line with one", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, "Constrained");

      const noStation = await expectFailure(tx, (sp) =>
        plan(sp, item.poItemId, { stageCode: null }),
      );
      expect(noStation.threw).toBe(true);
      expect(noStation.message).toContain("plan_entry_kind_stage");

      const stagedDispatch = await expectFailure(tx, (sp) =>
        plan(sp, item.poItemId, { kind: "Dispatch", stageCode: "READY", plannedQty: 10 }),
      );
      expect(stagedDispatch.threw).toBe(true);

      // The same item at the same station on the same day is one line.
      await plan(tx, item.poItemId, {});
      const twice = await expectFailure(tx, (sp) => plan(sp, item.poItemId, {}));
      expect(twice.message).toContain("plan_entry_key");
    });
  });
});

describe("the dispatch list on the dashboard (M3)", () => {
  it("ticks a line off by the challan, not by hand", async () => {
    await inRollback(async (tx) => {
      const item = await makeItem(tx, "Going out");
      await plan(tx, item.poItemId, { planDate: TODAY, kind: "Dispatch", plannedQty: 600 });

      const before = (await dispatchPlanFor(TODAY, tx)).find((l) => l.poItemId === item.poItemId)!;
      expect(before).toMatchObject({ plannedQty: 600, goneQty: 0 });

      const head = await auditedInsert(
        SYSTEM_ACTOR,
        dispatch,
        {
          challanNo: await allocateNumber(tx, "CH", TODAY),
          clientId: item.clientId,
          dispatchDate: TODAY,
          status: "Dispatched",
        },
        tx,
      );
      await auditedInsert(
        SYSTEM_ACTOR,
        dispatchLine,
        { dispatchId: head.id, poItemId: item.poItemId, qty: 600 },
        tx,
      );

      const after = (await dispatchPlanFor(TODAY, tx)).find((l) => l.poItemId === item.poItemId)!;
      expect(after.goneQty).toBe(600);
    });
  });
});
