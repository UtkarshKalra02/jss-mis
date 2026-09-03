import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, auditedUpdate, type Tx } from "@/db/audit";
import { jobCard, poItem, pressRun, purchaseOrder } from "@/db/schema";
import { allocateNumber, financialYearStart } from "@/lib/numbering";
import {
  gangInfoFor,
  getPressRun,
  getRunMembers,
  recentRuns,
} from "@/modules/press-runs/queries";

import { resolvedSheet } from "@/modules/press-runs/sheet";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Press runs — ganging (decision H1).
 *
 * The whole feature is a cross-client join, and cross-client is exactly what
 * every other document in this system forbids at the database (C8). So these
 * run against the real database rather than a mock: the interesting question is
 * whether Postgres lets a plate hold two clients, and only Postgres can answer
 * it.
 */

async function makeClient(tx: Tx, name: string): Promise<string> {
  const [row] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("PR")}, ${name}) returning id`,
    )
  ).rows as { id: string }[];
  return row!.id;
}

/** A client, an order and one item on it — the spine a job card hangs from. */
async function makeItem(tx: Tx, clientName: string) {
  const clientId = await makeClient(tx, clientName);

  const order = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", "2026-05-01"),
      poNo: uniq("PO"),
      clientId,
      poDate: "2026-05-01",
    },
    tx,
  );

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-05-01"),
      purchaseOrderId: order.id,
      itemName: `${clientName} carton`,
      orderedQty: 1000,
      committedDate: "2026-05-20",
    },
    tx,
  );

  return { clientId, poItemId: item.id };
}

async function makeJobCard(tx: Tx, poItemId: string) {
  return auditedInsert(
    SYSTEM_ACTOR,
    jobCard,
    {
      jcNo: await allocateNumber(tx, "JC", "2026-05-01"),
      poItemId,
      plannedQty: 500,
      plannedDate: "2026-05-10",
    },
    tx,
  );
}

async function makeRun(tx: Tx, runDate = "2026-05-10") {
  return auditedInsert(
    SYSTEM_ACTOR,
    pressRun,
    {
      runNo: await allocateNumber(tx, "PR", runDate),
      runDate,
      machine: "Komori 4-colour",
    },
    tx,
  );
}

describe("the PR number series", () => {
  it("is financial-year scoped, like every other document number", () => {
    // C7 and F10: the run's own date decides the year, not today.
    expect(financialYearStart("2026-05-10")).toBe(2026);
    expect(financialYearStart("2026-03-31")).toBe(2025);
  });

  it("allocates PR-YYYY-NNNN from the run's date", async () => {
    await inRollback(async (tx) => {
      const first = await allocateNumber(tx, "PR", "2026-05-10");
      const second = await allocateNumber(tx, "PR", "2026-05-11");

      expect(first).toMatch(/^PR-2026-\d{4}$/);
      expect(second).not.toBe(first);

      // A run back-dated into the previous financial year gets that year's
      // series, not this one's.
      expect(await allocateNumber(tx, "PR", "2026-03-20")).toMatch(/^PR-2025-\d{4}$/);
    });
  });
});

describe("ganging across clients (H3)", () => {
  it("puts job cards from DIFFERENT clients on one run, with no complaint", async () => {
    // The point of the feature. Everywhere else two clients on one document is
    // refused by a trigger (C8); on a plate it is why the plate exists.
    await inRollback(async (tx) => {
      const nature = await makeItem(tx, "Nature Packaging");
      const multi = await makeItem(tx, "Multiprint Industries");

      const run = await makeRun(tx);
      const a = await makeJobCard(tx, nature.poItemId);
      const b = await makeJobCard(tx, multi.poItemId);

      await auditedUpdate(SYSTEM_ACTOR, jobCard, a.id, { pressRunId: run.id }, tx);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, b.id, { pressRunId: run.id }, tx);

      const members = await getRunMembers(run.id, tx);
      expect(members).toHaveLength(2);
      expect(new Set(members.map((m) => m.clientId)).size).toBe(2);
    });
  });

  it("leaves po_item_id alone — one job card is still one item (H1)", async () => {
    // Ganging is a grouping ABOVE job cards. If this ever stops holding, the
    // spine rule in spec section 3 has been broken by the back door.
    await inRollback(async (tx) => {
      const nature = await makeItem(tx, "Nature Packaging");
      const run = await makeRun(tx);
      const card = await makeJobCard(tx, nature.poItemId);

      await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { pressRunId: run.id }, tx);

      const [row] = await tx.select().from(jobCard).where(eq(jobCard.id, card.id));
      expect(row!.poItemId).toBe(nature.poItemId);
      expect(row!.pressRunId).toBe(run.id);
    });
  });
});

describe("the ganged badge (H4)", () => {
  it("counts the OTHERS on the plate, not the members", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Gang A");
      const b = await makeItem(tx, "Gang B");
      const c = await makeItem(tx, "Gang C");

      const run = await makeRun(tx);
      const cards = [];
      for (const item of [a, b, c]) {
        const card = await makeJobCard(tx, item.poItemId);
        await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { pressRunId: run.id }, tx);
        cards.push(card);
      }

      const info = await gangInfoFor(
        cards.map((c) => c.id),
        tx,
      );

      // Three on the plate means each one is "ganged with 2 others".
      expect(info.size).toBe(3);
      for (const card of cards) {
        expect(info.get(card.id)!.others).toBe(2);
        expect(info.get(card.id)!.pressRunId).toBe(run.id);
      }
    });
  });

  it("reports zero others for a run holding one card", async () => {
    // Real and transient: somebody starts a run and adds the second job a
    // minute later. The screen links to the run without claiming a gang.
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Solo Client");
      const run = await makeRun(tx);
      const card = await makeJobCard(tx, a.poItemId);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { pressRunId: run.id }, tx);

      const info = await gangInfoFor([card.id], tx);
      expect(info.get(card.id)!.others).toBe(0);
    });
  });

  it("says nothing at all about a job card that was never ganged", async () => {
    // The overwhelming majority. A null press_run_id must stay invisible.
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Ungangled Client");
      const card = await makeJobCard(tx, a.poItemId);

      const info = await gangInfoFor([card.id], tx);
      expect(info.size).toBe(0);
      expect(info.get(card.id)).toBeUndefined();
    });
  });

  it("does not count a soft-deleted sibling as being on the plate", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Live Job");
      const b = await makeItem(tx, "Removed Job");
      const run = await makeRun(tx);

      const live = await makeJobCard(tx, a.poItemId);
      const gone = await makeJobCard(tx, b.poItemId);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, live.id, { pressRunId: run.id }, tx);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, gone.id, { pressRunId: run.id }, tx);

      await tx
        .update(jobCard)
        .set({ deletedAt: new Date() })
        .where(eq(jobCard.id, gone.id));

      expect((await gangInfoFor([live.id], tx)).get(live.id)!.others).toBe(0);
      expect(await getRunMembers(run.id, tx)).toHaveLength(1);
    });
  });
});

describe("removing a job card from a run", () => {
  it("returns it to the ordinary un-ganged state", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Rejoin Client");
      const run = await makeRun(tx);
      const card = await makeJobCard(tx, a.poItemId);

      await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { pressRunId: run.id }, tx);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { pressRunId: null }, tx);

      const [row] = await tx.select().from(jobCard).where(eq(jobCard.id, card.id));
      expect(row!.pressRunId).toBeNull();
      // Still a perfectly good job card against its own item.
      expect(row!.poItemId).toBe(a.poItemId);

      expect(await getRunMembers(run.id, tx)).toHaveLength(0);
      expect((await gangInfoFor([card.id], tx)).size).toBe(0);
    });
  });
});

describe("the run picker (H5)", () => {
  it("offers recent runs and not old ones", async () => {
    // "Open" means recent, because press_run has no status and inventing one
    // would be inventing a lifecycle nobody asked to maintain.
    await inRollback(async (tx) => {
      const [{ recent, old }] = (
        await tx.execute(sql`
          select (today_ist() - 3)::text as recent, (today_ist() - 200)::text as old
        `)
      ).rows as { recent: string; old: string }[];

      const fresh = await makeRun(tx, recent);
      const stale = await makeRun(tx, old);

      const offered = await recentRuns(tx);
      const ids = offered.map((r) => r.id);

      expect(ids).toContain(fresh.id);
      expect(ids).not.toContain(stale.id);
    });
  });

  it("counts how many jobs are already on each offered run", async () => {
    await inRollback(async (tx) => {
      const [{ recent }] = (
        await tx.execute(sql`select (today_ist() - 1)::text as recent`)
      ).rows as { recent: string }[];

      const run = await makeRun(tx, recent);
      const a = await makeItem(tx, "Count A");
      const b = await makeItem(tx, "Count B");

      for (const item of [a, b]) {
        const card = await makeJobCard(tx, item.poItemId);
        await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { pressRunId: run.id }, tx);
      }

      const offered = await recentRuns(tx);
      expect(offered.find((r) => r.id === run.id)!.cardCount).toBe(2);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The shared sheet, and which one wins (J15)                                  */
/* -------------------------------------------------------------------------- */

describe("resolving which sheet a card prints on", () => {
  const cardOwn = {
    paperSize: 'CARD 20" x 30"',
    paperGsm: "250",
    paperFinish: "Gloss",
    sheetsPerReam: 500,
    paperRemarks: "card remark",
    plateJobId: "CARD-PLATE",
    paperSupplyBy: "Press",
    plateSupplyBy: "Press",
    machineName: "SM-72 — 2 Colour",
    machineSheetSize: '20" x 28.5"',
  };

  const runSheet = {
    runNo: "PR-2026-0004",
    paperSize: 'RUN 25" x 36"',
    paperGsm: "100",
    paperFinish: "Matt",
    sheetsPerReam: 300,
    paperRemarks: "run remark",
    plateJobId: "RUN-PLATE",
    paperSupplyBy: "Party",
    plateSupplyBy: "Party",
    machineName: "SM-72 — 6 Colour",
    machineSheetSize: '20" x 28.5"',
  };

  it("uses the card's own sheet when it is not ganged", () => {
    const sheet = resolvedSheet({ ...cardOwn, pressRunId: null }, null);
    expect(sheet.fromRun).toBe(false);
    expect(sheet.paperSize).toBe('CARD 20" x 30"');
    expect(sheet.runNo).toBeNull();
  });

  it("lets the RUN win in full when the card is ganged", () => {
    const sheet = resolvedSheet({ ...cardOwn, pressRunId: "run-1" }, runSheet);

    // Not merged, not preferred-when-blank, not a fallback. One direction, or
    // there are two answers to "what am I printing on" (J15).
    expect(sheet.fromRun).toBe(true);
    expect(sheet.paperSize).toBe('RUN 25" x 36"');
    expect(sheet.paperGsm).toBe("100");
    expect(sheet.plateJobId).toBe("RUN-PLATE");
    expect(sheet.paperSupplyBy).toBe("Party");
    expect(sheet.machineName).toBe("SM-72 — 6 Colour");
    expect(sheet.runNo).toBe("PR-2026-0004");
  });

  it("does NOT fall back to the card when the run's field is empty", () => {
    // The card says 250 GSM and the run says nothing. The honest answer is
    // nothing: the run owns the sheet, and a blank on it is a gap to fill on
    // the run rather than a reason to read a dormant column.
    const sparse = { ...runSheet, paperGsm: null, plateJobId: null };
    const sheet = resolvedSheet({ ...cardOwn, pressRunId: "run-1" }, sparse);

    expect(sheet.paperGsm).toBeNull();
    expect(sheet.plateJobId).toBeNull();
  });

  it("uses the card when it names a run that could not be loaded", () => {
    // A soft-deleted run, say. Better the card's own values than nothing.
    const sheet = resolvedSheet({ ...cardOwn, pressRunId: "gone" }, null);
    expect(sheet.fromRun).toBe(false);
    expect(sheet.paperSize).toBe('CARD 20" x 30"');
  });
});

describe("the press run as a document", () => {
  it("holds one sheet and one set of run figures for the whole plate", async () => {
    await inRollback(async (tx) => {
      const run = await auditedInsert(
        SYSTEM_ACTOR,
        pressRun,
        {
          runNo: await allocateNumber(tx, "PR", "2026-05-10"),
          runDate: "2026-05-10",
          paperSize: '25" x 36"',
          paperGsm: "100",
          sheetsPerReam: 300,
          plateJobId: "PL-8891",
          paperSupplyBy: "Party",
          plateSupplyBy: "Press",
        },
        tx,
      );

      const read = await getPressRun(run.id, tx);
      expect(read!.paperSize).toBe('25" x 36"');
      expect(read!.sheetsPerReam).toBe(300);
      expect(read!.paperSupplyBy).toBe("Party");

      // Blank until somebody transcribes the printed run sheet (J4's rule,
      // applied to the run rather than the card).
      expect(read!.finalQty).toBeNull();
      expect(read!.wastageQty).toBeNull();
    });
  });

  it("refuses a negative run figure at the database", async () => {
    await inRollback(async (tx) => {
      const run = await auditedInsert(
        SYSTEM_ACTOR,
        pressRun,
        {
          runNo: await allocateNumber(tx, "PR", "2026-05-10"),
          runDate: "2026-05-10",
        },
        tx,
      );

      const failed = await expectFailure(tx, (sp) =>
        sp.execute(sql`update press_run set wastage_qty = -1 where id = ${run.id}`),
      );

      expect(failed.threw).toBe(true);
      expect(failed.message).toContain("press_run_wastage_qty_non_negative");
    });
  });

  it("gives every member its own design, so each can finish differently", async () => {
    await inRollback(async (tx) => {
      const a = await makeItem(tx, "Soap Co A");
      const b = await makeItem(tx, "Soap Co B");

      const run = await auditedInsert(
        SYSTEM_ACTOR,
        pressRun,
        {
          runNo: await allocateNumber(tx, "PR", "2026-05-10"),
          runDate: "2026-05-10",
        },
        tx,
      );

      for (const item of [a, b]) {
        await auditedInsert(
          SYSTEM_ACTOR,
          jobCard,
          {
            jcNo: await allocateNumber(tx, "JC", "2026-05-10"),
            poItemId: item.poItemId,
            pressRunId: run.id,
            plannedQty: 500,
          },
          tx,
        );
      }

      const members = await getRunMembers(run.id, tx);

      // Cross-client on one plate is the entire point and is never flagged
      // (H3). Each member carries its own design id, which is what lets the
      // run sheet print a separate fabrication block per job (H2).
      expect(members).toHaveLength(2);
      expect(new Set(members.map((m) => m.clientId)).size).toBe(2);
      expect(members.every((m) => "designId" in m)).toBe(true);
    });
  });
});
