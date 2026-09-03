import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, auditedSoftDelete, auditedUpdate, type Tx } from "@/db/audit";
import { design, designProcess, jobCard, poItem, purchaseOrder } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";
import { getJobCard, jobCardsForItem, liveCardCountFor } from "@/modules/job-cards/queries";
import { parseExecutionForm, parseReleaseForm } from "@/modules/job-cards/validation";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * Job card release (decision J1).
 *
 * Two halves, tested two ways. The FORM CONTRACT is checked against real
 * FormData objects built the way the browser builds them, because the
 * null-versus-undefined mismatch that broke every delegation status save (G10)
 * is invisible to a test that passes hand-written objects. Everything else runs
 * against the real database, because the constraints and the joins are the
 * things worth asserting and a mock would only confirm what the author already
 * believed.
 */

const ITEM_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/* -------------------------------------------------------------------------- */
/* The form contract                                                           */
/* -------------------------------------------------------------------------- */

describe("the release form's fields, as the browser posts them", () => {
  /** Exactly what the release form sends when only the item is chosen. */
  function minimal(): FormData {
    const form = new FormData();
    form.set("poItemId", ITEM_ID);
    // Every other input exists but is empty — a blank <input> posts "".
    form.set("plannedQty", "");
    form.set("plannedDate", "");
    form.set("paperSupplyBy", "");
    form.set("plateSupplyBy", "");
    form.set("plateJobId", "");
    form.set("machineId", "");
    form.set("notes", "");
    return form;
  }

  it("accepts a release with nothing but the item", () => {
    const parsed = parseReleaseForm(minimal());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // Blank must reach the action as undefined, never as "".
    expect(parsed.data.plannedQty).toBeUndefined();
    expect(parsed.data.paperSupplyBy).toBeUndefined();
    expect(parsed.data.machineId).toBeUndefined();
  });

  it("accepts a form that never rendered the optional fields at all", () => {
    // FormData.get() returns null for a field the form did not render. That is
    // a different value from "" and it is the one that shipped as a bug (G10).
    const form = new FormData();
    form.set("poItemId", ITEM_ID);

    const parsed = parseReleaseForm(form);
    expect(parsed.success).toBe(true);
  });

  it("coerces the planned quantity and refuses a non-positive one", () => {
    const form = minimal();
    form.set("plannedQty", "2500");
    const ok = parseReleaseForm(form);
    expect(ok.success && ok.data.plannedQty).toBe(2500);

    form.set("plannedQty", "0");
    expect(parseReleaseForm(form).success).toBe(false);
  });

  it("reads the second-card acknowledgement off the button's own value", () => {
    // The confirmation rides on the submit button's name/value, not a hidden
    // input driven by state: a click submits before React re-renders, so a
    // state-driven flag arrives one submit late (F20).
    const form = minimal();
    expect(parseReleaseForm(form).success && parseReleaseForm(form).data?.confirmSecondCard)
      .toBeUndefined();

    form.set("confirmSecondCard", "1");
    const confirmed = parseReleaseForm(form);
    expect(confirmed.success && confirmed.data.confirmSecondCard).toBe("1");
  });

  it("refuses a supply-by value that is not in the enum", () => {
    const form = minimal();
    form.set("paperSupplyBy", "Somebody else");
    expect(parseReleaseForm(form).success).toBe(false);
  });
});

describe("the execution form — transcribed off the paper card", () => {
  function execForm(extra: Record<string, string> = {}): FormData {
    const form = new FormData();
    form.set("id", ITEM_ID);
    form.set("finalQty", "");
    form.set("wastageQty", "");
    form.set("executionRemarks", "");
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  }

  it("accepts a card nobody has transcribed yet", () => {
    const parsed = parseExecutionForm(execForm());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.finalQty).toBeUndefined();
    expect(parsed.data.wastageQty).toBeUndefined();
  });

  it("accepts an over-run — final quantity is not capped", () => {
    // Planned 1000, ran 1120. Ordinary on a press, and a rule refusing the
    // true number would be answered by typing a false one.
    const parsed = parseExecutionForm(execForm({ finalQty: "1120" }));
    expect(parsed.success && parsed.data.finalQty).toBe(1120);
  });

  it("refuses negative quantities", () => {
    expect(parseExecutionForm(execForm({ finalQty: "-1" })).success).toBe(false);
    expect(parseExecutionForm(execForm({ wastageQty: "-5" })).success).toBe(false);
  });

  it("accepts zero wastage, which is a real answer", () => {
    const parsed = parseExecutionForm(execForm({ wastageQty: "0" }));
    expect(parsed.success && parsed.data.wastageQty).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Against the database                                                        */
/* -------------------------------------------------------------------------- */

async function makeItem(tx: Tx, opts: { withDesign?: boolean } = {}) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("JC")}, 'Job Card Co') returning id`,
    )
  ).rows as { id: string }[];

  let designId: string | null = null;
  if (opts.withDesign) {
    const d = await auditedInsert(
      SYSTEM_ACTOR,
      design,
      {
        designCode: uniq("DSN-"),
        clientId: c!.id,
        jobName: "Fertilina carton",
        jobSize: '12" x 9"',
        gsm: "300",
        paperType: "SBS Board",
        printType: "Offset",
        noOfColours: "4+0",
      },
      tx,
    );
    designId = d.id;

    // A route with two processes, so the checklist has something to mark.
    for (const code of ["PRINTING", "LAMINATION"]) {
      await auditedInsert(SYSTEM_ACTOR, designProcess, { designId, stageCode: code }, tx);
    }
  }

  const order = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", "2026-05-01"),
      clientId: c!.id,
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
      designId,
      itemName: "Fertilina carton",
      orderedQty: 5000,
      committedDate: "2026-05-20",
    },
    tx,
  );

  return { clientId: c!.id, orderId: order.id, itemId: item.id, designId };
}

async function release(tx: Tx, itemId: string, on = "2026-05-10", extra = {}) {
  return auditedInsert(
    SYSTEM_ACTOR,
    jobCard,
    {
      jcNo: await allocateNumber(tx, "JC", on),
      poItemId: itemId,
      plannedQty: 5000,
      plannedDate: on,
      ...extra,
    },
    tx,
  );
}

describe("releasing a job card", () => {
  it("numbers the card from its own date's financial year, not today's", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);

      // 29 March 2026 is still FY 2025-26 (C7, F10).
      const march = await release(tx, itemId, "2026-03-29");
      expect(march.jcNo).toMatch(/^JC-2025-\d{4}$/);

      const april = await release(tx, itemId, "2026-04-01");
      expect(april.jcNo).toMatch(/^JC-2026-\d{4}$/);
    });
  });

  it("keeps one card to exactly one item, and allows an item several", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);

      const first = await release(tx, itemId);
      const second = await release(tx, itemId);

      // H1 and spec section 3: a card covers ONE item, an item may have many.
      expect(first.poItemId).toBe(itemId);
      expect(second.poItemId).toBe(itemId);
      expect(first.id).not.toBe(second.id);
      expect(await liveCardCountFor(itemId, tx)).toBe(2);
    });
  });

  it("counts only live cards, so a removed one stops warning about itself", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      expect(await liveCardCountFor(itemId, tx)).toBe(1);
      await auditedSoftDelete(SYSTEM_ACTOR, jobCard, card.id, tx);
      expect(await liveCardCountFor(itemId, tx)).toBe(0);
    });
  });

  it("writes an audit row alongside the card", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      const rows = (
        await tx.execute(
          sql`select action from audit_log where table_name = 'job_card' and record_id = ${card.id}`,
        )
      ).rows as { action: string }[];

      expect(rows.map((r) => r.action)).toContain("INSERT");
    });
  });
});

describe("the card, read back for the screen and the print", () => {
  it("assembles the item, its order, its client and its design", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx, { withDesign: true });
      const card = await release(tx, itemId, "2026-05-10", {
        paperSupplyBy: "Party" as const,
        plateSupplyBy: "Press" as const,
        plateJobId: "PL-8891",
        paperSize: '25" x 36"',
        paperGsm: "100",
        sheetsPerReam: 300,
      });

      const read = await getJobCard(card.id, tx);
      expect(read).not.toBeNull();

      expect(read!.itemName).toBe("Fertilina carton");
      expect(read!.orderedQty).toBe(5000);
      expect(read!.clientName).toBe("Job Card Co");
      expect(read!.poInternalNo).toMatch(/^PO-/);

      // The paper detail the printed card carries.
      expect(read!.designGsm).toBe("300");
      expect(read!.designPaperType).toBe("SBS Board");

      expect(read!.paperSupplyBy).toBe("Party");
      expect(read!.plateSupplyBy).toBe("Press");

      // The PARENT SHEET, typed on the card — not design.job_size, which is
      // the finished size of the carton. Different facts (J11).
      expect(read!.paperSize).toBe('25" x 36"');
      expect(read!.sheetsPerReam).toBe(300);
    });
  });

  it("reads a card whose item has no design, rather than failing", async () => {
    await inRollback(async (tx) => {
      // Spec 6.3 makes the design optional on a PO item. A card for such an
      // item prints its paper lines blank for hand entry (J5); it is not an
      // error.
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      const read = await getJobCard(card.id, tx);
      expect(read).not.toBeNull();
      expect(read!.designId).toBeNull();
      expect(read!.designGsm).toBeNull();
    });
  });
});

describe("transcribing the run figures back off the paper", () => {
  it("records the final quantity, wastage and remarks without touching the plan", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId, "2026-05-10", { execNoOfColours: "4/c" });

      await auditedUpdate(
        SYSTEM_ACTOR,
        jobCard,
        card.id,
        { finalQty: 5120, wastageQty: 180, executionRemarks: "Slight set-off on the tail." },
        tx,
      );

      const [read] = await tx.select().from(jobCard).where(eq(jobCard.id, card.id));

      expect(read!.finalQty).toBe(5120);
      expect(read!.wastageQty).toBe(180);
      // The plan is untouched — that is the whole reason it is a separate form.
      expect(read!.plannedQty).toBe(5000);
      expect(read!.execNoOfColours).toBe("4/c");
    });
  });

  it("surfaces the run figures on the item tracker's panel", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { finalQty: 4900, wastageQty: 60 }, tx);

      const [row] = await jobCardsForItem(itemId, tx);
      expect(row!.finalQty).toBe(4900);
      expect(row!.wastageQty).toBe(60);
    });
  });

  it("is refused by the database when the numbers are negative", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      // The form refuses this too. The constraint is what makes it true for a
      // psql session and an import script as well (F11's reasoning).
      const failed = await expectFailure(tx, (sp) =>
        sp.execute(sql`update job_card set wastage_qty = -1 where id = ${card.id}`),
      );

      expect(failed.threw).toBe(true);
      expect(failed.message).toContain("job_card_wastage_qty_non_negative");
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Unreleasing — cancel and remove (J12)                                       */
/* -------------------------------------------------------------------------- */

describe("taking back a card that should not have been released", () => {
  it("stops counting toward the second-card warning once cancelled", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      expect(await liveCardCountFor(itemId, tx)).toBe(1);

      await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { status: "Cancelled" }, tx);

      // A card raised and then withdrawn did not run. Warning "this item
      // already has a card" on the strength of one somebody deliberately
      // cancelled is how a warning stops being read.
      expect(await liveCardCountFor(itemId, tx)).toBe(0);
    });
  });

  it("keeps a cancelled card, its number and its history", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);
      await auditedUpdate(SYSTEM_ACTOR, jobCard, card.id, { status: "Cancelled" }, tx);

      const read = await getJobCard(card.id, tx);
      expect(read).not.toBeNull();
      expect(read!.status).toBe("Cancelled");
      expect(read!.jcNo).toBe(card.jcNo);
    });
  });

  it("is refused by the database if put On Hold with no reason", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      // The form refuses this too. The CHECK is what makes it true for a psql
      // session as well (F11) — a card on hold with no reason is one nobody
      // can unblock.
      const failed = await expectFailure(tx, (sp) =>
        sp.execute(sql`update job_card set status = 'On Hold' where id = ${card.id}`),
      );

      expect(failed.threw).toBe(true);
      expect(failed.message).toContain("job_card_hold_reason_required");
    });
  });

  it("accepts On Hold once a reason is given", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      await auditedUpdate(
        SYSTEM_ACTOR,
        jobCard,
        card.id,
        { status: "On Hold", holdReason: "Waiting on the party's board" },
        tx,
      );

      const read = await getJobCard(card.id, tx);
      expect(read!.status).toBe("On Hold");
      expect(read!.holdReason).toBe("Waiting on the party's board");
    });
  });

  it("removes a card by soft delete, leaving the number consumed", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeItem(tx);
      const card = await release(tx, itemId);

      await auditedSoftDelete(SYSTEM_ACTOR, jobCard, card.id, tx);

      // Off every screen (non-negotiable 7 — soft delete only).
      expect(await getJobCard(card.id, tx)).toBeNull();
      expect(await jobCardsForItem(itemId, tx)).toHaveLength(0);

      // The row and its number survive, so the series cannot reissue it: the
      // sheet carrying it may already be lying on a press (C7).
      const rows = (
        await tx.execute(sql`select jc_no, deleted_at from job_card where id = ${card.id}`)
      ).rows as { jc_no: string; deleted_at: string | null }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.jc_no).toBe(card.jcNo);
      expect(rows[0]!.deleted_at).not.toBeNull();
    });
  });
});
