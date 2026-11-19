import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_ACTOR, auditedInsert, type Tx } from "@/db/audit";
import { poItem, purchaseOrder } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";
import {
  defaultPaperSupplyBy,
  paperSupplyWasDefaulted,
} from "@/modules/job-cards/supply";
import { poHeaderSchema } from "@/modules/purchase-orders/validation";

import { inRollback, uniq } from "./helpers";

/**
 * Job work — section Z, migration 0050.
 *
 * THE TEST THIS FILE EXISTS FOR is that po_awaited goes FALSE for job work.
 * `po_awaited` means "no PO number, and a person typed this rather than
 * importing it" (N1) — a prompt to go and fetch the document. For job work
 * there is no document and never will be, so without the third term in that
 * expression a job-work order would sit in the Item Tracker asking for one
 * permanently. Everything else here guards the edges of that.
 */

async function makeOrder(
  tx: Tx,
  opts: { jobWork?: boolean; poNo?: string | null } = {},
) {
  const [c] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("JW")}, 'Job Work Co') returning id`,
    )
  ).rows as { id: string }[];

  const order = await auditedInsert(
    SYSTEM_ACTOR,
    purchaseOrder,
    {
      internalNo: await allocateNumber(tx, "PO", "2026-11-19"),
      clientId: c!.id,
      poDate: "2026-11-19",
      poNo: opts.poNo ?? null,
      ...(opts.jobWork === undefined ? {} : { isJobWork: opts.jobWork }),
    },
    tx,
  );

  const item = await auditedInsert(
    SYSTEM_ACTOR,
    poItem,
    {
      itemCode: await allocateNumber(tx, "ITM", "2026-11-19"),
      purchaseOrderId: order.id,
      itemName: "Job work carton",
      orderedQty: 5000,
    },
    tx,
  );

  return { orderId: order.id, itemId: item.id };
}

async function statusRow(tx: Tx, itemId: string) {
  const r = await tx.execute(
    sql`select po_awaited, is_job_work from v_po_item_status where po_item_id = ${itemId}`,
  );
  return r.rows[0] as { po_awaited: boolean; is_job_work: boolean };
}

describe("po_awaited stops firing for job work", () => {
  it("an ordinary order with no PO number IS awaited", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeOrder(tx);
      const row = await statusRow(tx, itemId);

      expect(row.po_awaited).toBe(true);
      expect(row.is_job_work).toBe(false);
    });
  });

  it("a job-work order with no PO number is NOT awaited", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeOrder(tx, { jobWork: true });
      const row = await statusRow(tx, itemId);

      expect(row.po_awaited).toBe(false);
      expect(row.is_job_work).toBe(true);
    });
  });

  /**
   * The two markers are mutually exclusive by construction, which is what lets
   * the screens render one or the other without deciding a precedence.
   */
  it("never reports both at once", async () => {
    await inRollback(async (tx) => {
      for (const jobWork of [true, false]) {
        const { itemId } = await makeOrder(tx, { jobWork });
        const row = await statusRow(tx, itemId);
        expect(row.po_awaited && row.is_job_work).toBe(false);
      }
    });
  });

  it("leaves an ordinary order WITH a PO number unawaited, as before", async () => {
    await inRollback(async (tx) => {
      const { itemId } = await makeOrder(tx, { poNo: "4500123456" });
      expect((await statusRow(tx, itemId)).po_awaited).toBe(false);
    });
  });

  it("defaults to not job work, so nothing existing changed meaning", async () => {
    await inRollback(async (tx) => {
      // No isJobWork passed at all — the column's NOT NULL DEFAULT false is
      // what every row written before 0050 has.
      const { itemId } = await makeOrder(tx);
      expect((await statusRow(tx, itemId)).is_job_work).toBe(false);
    });
  });
});

describe("the job-work box, as the browser posts it", () => {
  function header(extra: Record<string, string> = {}): FormData {
    const form = new FormData();
    // A real v4 UUID: zod's uuid() checks the version and variant nibbles,
    // so an all-ones string is not a valid stand-in.
    form.set("clientId", "11111111-1111-4111-8111-111111111111");
    form.set("poNo", "");
    form.set("poDate", "2026-11-19");
    form.set("fileUrl", "");
    form.set("notes", "");
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  }

  function parse(form: FormData) {
    return poHeaderSchema.safeParse({
      clientId: form.get("clientId"),
      poNo: form.get("poNo"),
      poDate: form.get("poDate"),
      fileUrl: form.get("fileUrl"),
      isJobWork: form.get("isJobWork") ?? undefined,
      notes: form.get("notes"),
    });
  }

  /** An unticked checkbox posts NOTHING — not "off", not "". */
  it("reads an absent box as not job work", () => {
    const parsed = parse(header());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.isJobWork).toBeUndefined();
      expect(parsed.data.isJobWork === "on").toBe(false);
    }
  });

  it("reads a ticked box as job work", () => {
    const parsed = parse(header({ isJobWork: "on" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.isJobWork === "on").toBe(true);
  });

  it("refuses a value no checkbox would ever post", () => {
    expect(parse(header({ isJobWork: "true" })).success).toBe(false);
    expect(parse(header({ isJobWork: "yes" })).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The paper-supply default — section Z                                        */
/* -------------------------------------------------------------------------- */

describe("what Paper supplied by shows before anybody touches it", () => {
  it("offers Party when releasing a card for job work", () => {
    expect(defaultPaperSupplyBy({ mode: "release", isJobWork: true })).toBe("Party");
    expect(paperSupplyWasDefaulted({ mode: "release", isJobWork: true })).toBe(true);
  });

  it("stays blank on an ordinary order", () => {
    expect(defaultPaperSupplyBy({ mode: "release", isJobWork: false })).toBeUndefined();
    expect(defaultPaperSupplyBy({ mode: "release" })).toBeUndefined();
    expect(paperSupplyWasDefaulted({ mode: "release", isJobWork: false })).toBe(false);
  });

  /** A person decided this. Nothing here overrides it. */
  it("never overrides a stored answer, job work or not", () => {
    expect(
      defaultPaperSupplyBy({ stored: "Press", mode: "release", isJobWork: true }),
    ).toBe("Press");
    expect(defaultPaperSupplyBy({ stored: "Party", mode: "edit", isJobWork: false })).toBe(
      "Party",
    );
    // A stored value is never "defaulted", so the screen says nothing about it.
    expect(
      paperSupplyWasDefaulted({ stored: "Press", mode: "release", isJobWork: true }),
    ).toBe(false);
  });

  /**
   * THE CASE THE MODE TEST EXISTS FOR. An existing job-work card whose supply
   * was never recorded must stay blank: otherwise opening it and saving any
   * other field writes Party into a column nobody answered — the backfill W1
   * and Y2 both refuse, arriving through a form instead of a migration.
   */
  it("does NOT default on an existing card, even for job work", () => {
    expect(defaultPaperSupplyBy({ mode: "edit", isJobWork: true })).toBeUndefined();
    expect(
      defaultPaperSupplyBy({ stored: null, mode: "edit", isJobWork: true }),
    ).toBeUndefined();
    expect(paperSupplyWasDefaulted({ mode: "edit", isJobWork: true })).toBe(false);
  });

  it("treats an empty stored string as unanswered rather than as a value", () => {
    expect(defaultPaperSupplyBy({ stored: "", mode: "release", isJobWork: true })).toBe(
      "Party",
    );
    expect(defaultPaperSupplyBy({ stored: "", mode: "edit", isJobWork: true })).toBeUndefined();
  });
});
