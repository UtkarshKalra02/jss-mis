import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Tx } from "@/db/audit";
import { SYSTEM_ACTOR, auditedInsert, auditedUpdate, type Actor } from "@/db/audit";
import { enquiry } from "@/db/schema";
import { canAssignEnquiryOwner, resolveEnquiryOwner } from "@/modules/enquiries/permissions";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * THE SECOND EXCEPTION TO B2, pinned in both directions (K15).
 *
 * B2 makes OWNER globally deny-write inside the audit wrapper. K15 carves out
 * one field on one table — `enquiry.owner_user_id` — on the same reasoning J26
 * used for delegation: allocating work is the thing an owner does that is not
 * running the business through somebody else's screen.
 *
 * The carve-out is narrow in FACT only while this file passes. Both halves
 * matter and the second matters more: it is easy to write a test proving the
 * new thing works and never prove that nothing else came with it.
 */

async function fixture(tx: Tx) {
  const [client] = (
    await tx.execute(
      sql`insert into client (code, name) values (${uniq("EQ")}, 'Enquiry Client') returning id`,
    )
  ).rows as { id: string }[];

  const [source] = (
    await tx.execute(sql`select id from enquiry_source where code = 'OTHER'`)
  ).rows as { id: string }[];

  const users = (
    await tx.execute(sql`select id, role from app_user order by created_at limit 5`)
  ).rows as { id: string; role: string }[];

  const row = await auditedInsert(
    SYSTEM_ACTOR,
    enquiry,
    {
      enquiryNo: uniq("ENQ-"),
      clientId: client!.id,
      enquiryDate: "2026-09-08",
      sourceId: source!.id,
      itemDescription: "Mono carton, for the owner-assignment test",
      ownerUserId: users[0]!.id,
    },
    tx,
  );

  return { enquiryId: row.id, users };
}

const owner = (id: string): Actor => ({ id, role: "OWNER" });

describe("who may say who chases an enquiry", () => {
  it("is ADMIN and OWNER, and nobody else", () => {
    expect(canAssignEnquiryOwner("ADMIN")).toBe(true);
    expect(canAssignEnquiryOwner("OWNER")).toBe(true);

    // The three roles that CAN raise an enquiry but cannot hand it on.
    expect(canAssignEnquiryOwner("ORDER_DESK")).toBe(false);
    expect(canAssignEnquiryOwner("PLANNER")).toBe(false);
    expect(canAssignEnquiryOwner("ACCOUNTS")).toBe(false);
    expect(canAssignEnquiryOwner("FLOOR")).toBe(false);
  });

  it("ignores a posted owner from somebody who cannot assign", () => {
    // A select that is not rendered is not a permission. The posted value is
    // dropped on the server rather than trusted because the form omitted it.
    expect(resolveEnquiryOwner("ORDER_DESK", "somebody-else", "me")).toBe("me");
    expect(resolveEnquiryOwner("PLANNER", "somebody-else", "me")).toBe("me");
  });

  it("honours a posted owner from somebody who can", () => {
    expect(resolveEnquiryOwner("ADMIN", "somebody-else", "me")).toBe("somebody-else");
    expect(resolveEnquiryOwner("OWNER", "somebody-else", "me")).toBe("somebody-else");
  });

  it("falls back to the row's existing owner, not to the editor", () => {
    // An order-desk edit must leave an assignment Amit made standing.
    expect(resolveEnquiryOwner("ORDER_DESK", undefined, "assigned-by-amit")).toBe(
      "assigned-by-amit",
    );
  });
});

describe("what the audit wrapper lets an OWNER do to an enquiry", () => {
  it("allows the owner field, alone", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const amit = owner(f.users[0]!.id);

      await auditedUpdate(amit, enquiry, f.enquiryId, { ownerUserId: f.users[1]!.id }, tx);

      const [row] = (
        await tx.execute(sql`select owner_user_id from enquiry where id = ${f.enquiryId}`)
      ).rows as { owner_user_id: string }[];

      expect(row!.owner_user_id).toBe(f.users[1]!.id);
    });
  });

  it("refuses every other field on the same row", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const amit = owner(f.users[0]!.id);

      // Each of these is a write B2 still forbids, on the ONE table where the
      // carve-out applies. That is the case worth testing — a blanket refusal
      // on another table would pass for the wrong reason.
      for (const values of [
        { status: "Won" as const },
        { itemDescription: "rewritten by the owner" },
        { qty: 999 },
        { clientRequiredDate: "2026-12-01" },
      ]) {
        const result = await expectFailure(tx, (sp) =>
          auditedUpdate(amit, enquiry, f.enquiryId, values, sp),
        );
        expect(result.threw, `${Object.keys(values)[0]} should be refused`).toBe(true);
        expect(result.message).toMatch(/read-only|OWNER/i);
      }
    });
  });

  it("refuses the owner field when anything else rides along with it", async () => {
    // THE SMUGGLING CASE. Every key must be allowed, not merely one of them —
    // a partial match that silently dropped the rest would be worse than a
    // refusal, because the caller would believe the whole update landed.
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const amit = owner(f.users[0]!.id);

      const result = await expectFailure(tx, (sp) =>
        auditedUpdate(
          amit,
          enquiry,
          f.enquiryId,
          { ownerUserId: f.users[1]!.id, status: "Won" },
          sp,
        ),
      );

      expect(result.threw).toBe(true);
    });
  });

  it("still refuses an OWNER creating or deleting an enquiry", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const amit = owner(f.users[0]!.id);

      const [client] = (
        await tx.execute(
          sql`insert into client (code, name) values (${uniq("EQ2")}, 'Another') returning id`,
        )
      ).rows as { id: string }[];
      const [source] = (
        await tx.execute(sql`select id from enquiry_source where code = 'OTHER'`)
      ).rows as { id: string }[];

      const insert = await expectFailure(tx, (sp) =>
        auditedInsert(
          amit,
          enquiry,
          {
            enquiryNo: uniq("ENQ-"),
            clientId: client!.id,
            enquiryDate: "2026-09-08",
            sourceId: source!.id,
            itemDescription: "Amit should not be able to raise this",
            ownerUserId: f.users[1]!.id,
          },
          sp,
        ),
      );
      expect(insert.threw).toBe(true);
    });
  });
});
