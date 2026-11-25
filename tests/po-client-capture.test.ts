import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { findExistingClientId } from "@/modules/clients/resolve";
import { createPoSchema, poHeaderSchema } from "@/modules/purchase-orders/validation";

import { inRollback, uniq } from "./helpers";

/**
 * Capturing an order for a client who is not on the master yet (K20a).
 *
 * "Preeti can create clients while making jobwork job cards." Job work is the
 * case: a client PO carries its client with it, job work arrives as a name
 * nobody has entered. So the capture form types the client instead of choosing
 * one, and two things had to be true for that to be safe —
 *
 *   1. The CAPTURE schema accepts a name without an id, while the EDIT schema
 *      still demands an id. Re-assigning an existing order to a different
 *      customer is a choice among customers who exist; a typo there would
 *      invent a client and move an order onto it in one action.
 *
 *   2. The duplicate-PO-number check still asks its question. It needs a
 *      client that exists, so it runs against `findExistingClientId`, which
 *      finds and never creates.
 */

const ITEM = {
  itemName: "250ml carton — outer",
  orderedQty: "500",
  committedDate: "2026-12-01",
  jobType: "New",
  priority: "Normal",
  confirmationSource: "PO",
  confirmedBy: "11111111-1111-4111-8111-111111111111",
  confirmedAt: "2026-11-24T10:00",
};

const header = (over: Record<string, unknown>) => ({
  poNo: "",
  poDate: "2026-11-24",
  fileUrl: "",
  notes: "",
  items: [ITEM],
  ...over,
});

describe("createPoSchema — the client is typed", () => {
  it("accepts a name with no id, which is what a new client looks like", () => {
    const parsed = createPoSchema.safeParse(
      header({ clientId: "", clientName: "Natureexpert Ayurvedic" }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Blank becomes undefined rather than failing z.uuid(): the browser sends
      // the field on every submit and leaves it empty when it resolved nothing.
      expect(parsed.data.clientId).toBeUndefined();
      expect(parsed.data.clientName).toBe("Natureexpert Ayurvedic");
    }
  });

  it("accepts a name WITH an id, which is what the picker sends once it resolves", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const parsed = createPoSchema.safeParse(header({ clientId: id, clientName: "Kaya Beauty" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.clientId).toBe(id);
  });

  it("refuses an empty client box", () => {
    const parsed = createPoSchema.safeParse(header({ clientId: "", clientName: "  " }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.message).toContain("which client");
    }
  });

  it("still demands an id when an EXISTING order is being re-assigned", () => {
    /*
     * The edit form posts poHeaderSchema, deliberately untouched by K20a. If
     * this ever starts passing, somebody has made a misspelling on the edit
     * screen able to create a client and move an order onto it.
     */
    const parsed = poHeaderSchema.safeParse({
      clientId: "",
      clientName: "Somebody New",
      poNo: "",
      poDate: "2026-11-24",
      fileUrl: "",
      notes: "",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("findExistingClientId — for the questions asked before anything is written", () => {
  it("finds a client whose name matches after normalising", async () => {
    await inRollback(async (tx) => {
      const name = uniq("Natureexpert Ayurvedic ");
      const [existing] = (
        await tx.execute(
          sql`insert into client (code, name) values (${uniq("NAT")}, ${name}) returning id`,
        )
      ).rows as { id: string }[];

      // Typed with a legal suffix the master does not carry — the same customer.
      expect(await findExistingClientId(tx, `${name} Pvt Ltd`)).toBe(existing!.id);
    });
  });

  it("returns null for a name nobody has entered, and creates nothing", async () => {
    await inRollback(async (tx) => {
      const name = uniq("Nobody Has This Name ");
      expect(await findExistingClientId(tx, name)).toBeNull();

      // The point of this function: it answers without writing. A duplicate
      // check that created a client as a side effect would put a row in the
      // master every time somebody typed a PO number twice.
      const [row] = (
        await tx.execute(sql`select count(*)::int as n from client where name = ${name}`)
      ).rows as { n: number }[];
      expect(row!.n).toBe(0);
    });
  });

  it("returns null for a near match rather than naming the wrong customer", async () => {
    await inRollback(async (tx) => {
      const base = uniq("Kaya Beauty Care ");
      await tx.execute(sql`insert into client (code, name) values (${uniq("KBC")}, ${base})`);

      /*
       * Close, not equal. Only an exact normalised match counts: a duplicate
       * warning that said "this client already has PO 4471" about a customer
       * nobody named would be worse than no warning. resolveClientId refuses
       * this case a moment later anyway, with the candidates listed.
       */
      expect(await findExistingClientId(tx, `${base} Products`)).toBeNull();
    });
  });

  it("returns null for a blank name without going near the database", async () => {
    await inRollback(async (tx) => {
      expect(await findExistingClientId(tx, "   ")).toBeNull();
    });
  });
});
