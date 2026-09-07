import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { jobCard, poItem, pressRun, purchaseOrder } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";
import { releasableItemsByIds } from "@/modules/job-cards/queries";
import { parseBulkReleaseForm } from "@/modules/job-cards/validation";
import { getRunMembers } from "@/modules/press-runs/queries";
import { resolvedSheet } from "@/modules/press-runs/sheet";

import { inRollback, uniq } from "./helpers";

/**
 * Raising several cards on one plate — decision J20.
 *
 * The property under test is the one the feature was nearly not built for: this
 * writes N job cards, not one card covering N items. The spine holds (spec
 * section 3, H1), and what is shared lives on the run.
 *
 * The action itself needs a session, so what runs here is the shape it writes
 * plus the two pure pieces it depends on — the parse and the batch lookup.
 * `tests/job-card.test.ts` takes the same approach for the single release.
 */

async function itemFor(tx: Tx, clientName: string, orderedQty = 5000) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("BR")}, ${clientName}) returning id`,
    )
  ).rows as { id: string }[];

  const po = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", "2026-09-01"),
      clientId: c!.id,
      poDate: "2026-09-01",
    },
    tx,
  );

  return auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-09-01"),
      purchaseOrderId: po.id,
      itemName: `${clientName} wrapper`,
      orderedQty,
      committedDate: "2026-09-20",
    },
    tx,
  );
}

/** What the action writes: one run carrying the sheet, N cards pointing at it. */
async function raiseGang(tx: Tx, itemIds: string[], runDate = "2026-09-10") {
  const run = await auditedInsert(
    SYSTEM_ACTOR,
    pressRun,
    {
      runNo: await allocateNumber(tx, "PR", runDate),
      runDate,
      paperSize: '25" x 36"',
      paperGsm: "100",
      paperQty: 5,
      paperBundle: "Packet",
      paperParts: 2,
      plateJobId: "PL-9001",
    },
    tx,
  );

  for (const poItemId of itemIds) {
    await auditedInsert(
      SYSTEM_ACTOR,
      jobCard,
      {
        jcNo: await allocateNumber(tx, "JC", runDate),
        poItemId,
        plannedQty: 1000,
        plannedDate: runDate,
        pressRunId: run.id,
      },
      tx,
    );
  }

  return run;
}

describe("what a bulk release writes", () => {
  it("creates ONE card per item, each still pointing at its own item", async () => {
    // The whole argument. Three items on one plate is three job cards, not one
    // card covering three items — spec section 3's spine, and H1's rule that
    // ganging is a grouping ABOVE job cards rather than a loosening below them.
    await inRollback(async (tx) => {
      const items = [
        await itemFor(tx, "Nature Packaging"),
        await itemFor(tx, "Multiprint Industries"),
        await itemFor(tx, "Hotel Amenities Co"),
      ];

      const run = await raiseGang(
        tx,
        items.map((i) => i.id),
      );

      const members = await getRunMembers(run.id, tx);
      expect(members).toHaveLength(3);

      // Each card points at exactly one item, and they are the three asked for.
      const cards = await tx.select().from(jobCard).where(eq(jobCard.pressRunId, run.id));
      expect(new Set(cards.map((c) => c.poItemId))).toEqual(new Set(items.map((i) => i.id)));

      // Three distinct JC numbers. One document per job, as on paper.
      expect(new Set(cards.map((c) => c.jcNo)).size).toBe(3);
    });
  });

  it("puts three clients on one plate without complaint", async () => {
    // Cross-client is refused everywhere else by a trigger (C8) and is the
    // entire reason a plate exists (H3).
    await inRollback(async (tx) => {
      const items = [
        await itemFor(tx, "Client One"),
        await itemFor(tx, "Client Two"),
        await itemFor(tx, "Client Three"),
      ];

      const run = await raiseGang(
        tx,
        items.map((i) => i.id),
      );

      const members = await getRunMembers(run.id, tx);
      expect(new Set(members.map((m) => m.clientId)).size).toBe(3);
    });
  });

  it("gives every card the plate's date, because one plate is one trip", async () => {
    await inRollback(async (tx) => {
      const items = [await itemFor(tx, "Alpha"), await itemFor(tx, "Beta")];

      const run = await raiseGang(
        tx,
        items.map((i) => i.id),
        "2026-09-14",
      );

      const cards = await tx.select().from(jobCard).where(eq(jobCard.pressRunId, run.id));
      expect(cards.every((c) => c.plannedDate === "2026-09-14")).toBe(true);
      expect(run.runDate).toBe("2026-09-14");
    });
  });

  it("keeps the sheet on the RUN, so the cards cannot disagree with it", async () => {
    // J15's resolution rule only goes one way. Writing paper onto these cards
    // as well would create the second answer that rule exists to prevent.
    await inRollback(async (tx) => {
      const items = [await itemFor(tx, "Sheet A"), await itemFor(tx, "Sheet B")];

      const run = await raiseGang(
        tx,
        items.map((i) => i.id),
      );

      const cards = await tx.select().from(jobCard).where(eq(jobCard.pressRunId, run.id));

      for (const card of cards) {
        expect(card.paperSize).toBeNull();
        expect(card.paperQty).toBeNull();
        expect(card.paperBundle).toBeNull();
      }

      // And the card resolves through the run, which is what prints.
      const sheet = resolvedSheet(
        {
          ...cards[0]!,
          paperSupplyBy: null,
          plateSupplyBy: null,
          machineName: null,
          machineSheetSize: null,
        },
        {
          ...run,
          runNo: run.runNo,
          paperSupplyBy: null,
          plateSupplyBy: null,
          machineName: null,
          machineSheetSize: null,
        },
      );

      expect(sheet.fromRun).toBe(true);
      expect(sheet.paperQty).toBe(5);
      expect(sheet.paperBundle).toBe("Packet");
      expect(sheet.paperParts).toBe(2);
    });
  });
});

describe("what the batch lookup reports before anything is written", () => {
  it("returns the items asked for, with what is still owed", async () => {
    await inRollback(async (tx) => {
      const a = await itemFor(tx, "Lookup A", 4000);
      const b = await itemFor(tx, "Lookup B", 7000);

      const found = await releasableItemsByIds([a.id, b.id], tx);

      expect(found).toHaveLength(2);
      expect(found.find((i) => i.poItemId === a.id)!.pendingQty).toBe(4000);
      expect(found.find((i) => i.poItemId === b.id)!.pendingQty).toBe(7000);
    });
  });

  it("simply omits an id it cannot find, so the caller can name it", async () => {
    // A better message than "one of those items is gone".
    await inRollback(async (tx) => {
      const a = await itemFor(tx, "Present");
      const missing = "00000000-0000-4000-8000-000000000000";

      const found = await releasableItemsByIds([a.id, missing], tx);

      expect(found.map((i) => i.poItemId)).toEqual([a.id]);
    });
  });

  it("counts live cards per item, so J3 is asked once for the batch", async () => {
    await inRollback(async (tx) => {
      const a = await itemFor(tx, "Has A Card");
      const b = await itemFor(tx, "Fresh");

      await auditedInsert(
        SYSTEM_ACTOR,
        jobCard,
        { jcNo: await allocateNumber(tx, "JC", "2026-09-01"), poItemId: a.id },
        tx,
      );

      const found = await releasableItemsByIds([a.id, b.id], tx);

      expect(found.find((i) => i.poItemId === a.id)!.cardCount).toBe(1);
      expect(found.find((i) => i.poItemId === b.id)!.cardCount).toBe(0);
    });
  });
});

describe("the bulk release form contract", () => {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];

  function form(over: Record<string, string> = {}, items = ids, qtys = ["1000", "2000"]) {
    const f = new FormData();
    f.set("runDate", "2026-09-10");
    for (const id of items) f.append("poItemId", id);
    for (const q of qtys) f.append("plannedQty", q);
    for (const [k, val] of Object.entries({
      machineId: "",
      paperSize: '25" x 36"',
      paperGsm: "100",
      paperFinish: "",
      paperQty: "5",
      paperBundle: "Packet",
      paperParts: "2",
      paperRemarks: "",
      plateJobId: "",
      paperSupplyBy: "",
      plateSupplyBy: "",
      notes: "",
      confirmSecondCards: "",
      ...over,
    })) {
      f.set(k, val);
    }
    return f;
  }

  it("accepts two items with their quantities", () => {
    const parsed = parseBulkReleaseForm(form());

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.poItemIds).toEqual(ids);
    expect(parsed.data.plannedQtys).toEqual([1000, 2000]);
    expect(parsed.data.paperBundle).toBe("Packet");
  });

  it("refuses a plate of one — that is an ordinary release", () => {
    // The same threshold H8 uses before collapsing a run on Stage Update: a
    // plate holding one job protects against nothing and the single form does
    // it better.
    const parsed = parseBulkReleaseForm(form({}, [ids[0]!], ["1000"]));

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]!.message).toContain("at least two");
  });

  it("refuses items and quantities that do not line up", () => {
    // Two arrays read column-wise. A mismatch means a quantity would land on
    // the wrong client's job, so it is refused rather than guessed at.
    const parsed = parseBulkReleaseForm(form({}, ids, ["1000"]));

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]!.message).toContain("do not line up");
  });

  it("treats a blank quantity as all of what is still owed", () => {
    const parsed = parseBulkReleaseForm(form({}, ids, ["", "2000"]));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // undefined, not 0 — the action fills it from the view.
    expect(parsed.data.plannedQtys[0]).toBeUndefined();
    expect(parsed.data.plannedQtys[1]).toBe(2000);
  });

  it("refuses paper quantity with no bundle, the same as the card form", () => {
    const parsed = parseBulkReleaseForm(form({ paperBundle: "" }));

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]!.message).toContain("packet, ream or gross");
  });

  it("requires a date for the plate", () => {
    const parsed = parseBulkReleaseForm(form({ runDate: "" }));
    expect(parsed.success).toBe(false);
  });
});
