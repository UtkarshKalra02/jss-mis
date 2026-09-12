import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { can } from "@/auth/roles";
import type { Tx } from "@/db/audit";
import {
  ReadOnlyRoleError,
  SYSTEM_ACTOR,
  auditedInsert,
  auditedSoftDelete,
  auditedUpdate,
  type Actor,
} from "@/db/audit";
import { client, enquiry } from "@/db/schema";
import { resolveClientId } from "@/modules/clients/resolve";

import { expectFailure, inRollback, uniq } from "./helpers";

/**
 * THE THIRD EXCEPTION TO B2, pinned in both directions (K20).
 *
 * An OWNER may add an enquiry and add a client. He may not edit or remove
 * either, and he may not add anything else. The second half is the one that
 * matters: proving the new thing works is easy, proving nothing came with it
 * is what keeps B2 true.
 */

const owner = (id: string): Actor => ({ id, role: "OWNER" });

async function amit(tx: Tx): Promise<Actor> {
  const [row] = (
    await tx.execute(sql`select id from app_user where role = 'OWNER' limit 1`)
  ).rows as { id: string }[];
  // Any active user id will do for the actor stamp; the role is what is tested.
  return owner(row?.id ?? SYSTEM_ACTOR.id);
}

async function sourceId(tx: Tx): Promise<string> {
  const [source] = (
    await tx.execute(sql`select id from enquiry_source where code = 'OTHER'`)
  ).rows as { id: string }[];
  return source!.id;
}

describe("the matrix offers exactly what the wrapper permits", () => {
  it("grants OWNER create, and not write, on enquiry and client", () => {
    expect(can("OWNER", "enquiry", "create")).toBe(true);
    expect(can("OWNER", "client", "create")).toBe(true);
    expect(can("OWNER", "enquiry", "write")).toBe(false);
    expect(can("OWNER", "client", "write")).toBe(false);
  });

  it("keeps the ordering read < create < write for everybody else", () => {
    expect(can("ADMIN", "client", "create")).toBe(true);
    expect(can("ORDER_DESK", "client", "create")).toBe(true);
    expect(can("PLANNER", "client", "create")).toBe(false);
    expect(can("PLANNER", "client", "read")).toBe(true);
    expect(can("FLOOR", "client", "read")).toBe(false);
  });
});

describe("what the audit wrapper lets an OWNER add", () => {
  it("lets him add a client", async () => {
    await inRollback(async (tx) => {
      const row = await auditedInsert(
        await amit(tx),
        client,
        { code: uniq("OW"), name: "Client Amit added" },
        tx,
      );
      expect(row.id).toBeTruthy();
    });
  });

  it("lets him record an enquiry", async () => {
    await inRollback(async (tx) => {
      const actor = await amit(tx);
      const c = await auditedInsert(actor, client, { code: uniq("OW"), name: "Caller" }, tx);

      const row = await auditedInsert(
        actor,
        enquiry,
        {
          enquiryNo: uniq("ENQ-"),
          clientId: c.id,
          enquiryDate: "2026-09-12",
          sourceId: await sourceId(tx),
          itemDescription: "Mono carton, recorded by the owner",
          ownerUserId: actor.id,
        },
        tx,
      );
      expect(row.id).toBeTruthy();
    });
  });

  it("creates a client for him from a typed name, like any other creator", async () => {
    await inRollback(async (tx) => {
      const name = `Owner Typed ${uniq("")}`;
      const result = await resolveClientId(tx, await amit(tx), { clientName: name });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.created).toBe(true);
    });
  });
});

describe("what did NOT come with it", () => {
  it("still refuses him editing or removing a client", async () => {
    await inRollback(async (tx) => {
      const actor = await amit(tx);
      const c = await auditedInsert(actor, client, { code: uniq("OW"), name: "Mine" }, tx);

      // Even one he added himself: creating is not owning.
      const update = await expectFailure(tx, (sp) =>
        auditedUpdate(actor, client, c.id, { name: "Renamed" }, sp),
      );
      expect(update.threw).toBe(true);

      const remove = await expectFailure(tx, (sp) => auditedSoftDelete(actor, client, c.id, sp));
      expect(remove.threw).toBe(true);
    });
  });

  it("still refuses him editing or removing an enquiry beyond the K15 field", async () => {
    await inRollback(async (tx) => {
      const actor = await amit(tx);
      const c = await auditedInsert(actor, client, { code: uniq("OW"), name: "Caller" }, tx);
      const e = await auditedInsert(
        actor,
        enquiry,
        {
          enquiryNo: uniq("ENQ-"),
          clientId: c.id,
          enquiryDate: "2026-09-12",
          sourceId: await sourceId(tx),
          itemDescription: "Recorded, then not editable",
          ownerUserId: actor.id,
        },
        tx,
      );

      const update = await expectFailure(tx, (sp) =>
        auditedUpdate(actor, enquiry, e.id, { itemDescription: "Changed" }, sp),
      );
      expect(update.threw).toBe(true);

      const remove = await expectFailure(tx, (sp) => auditedSoftDelete(actor, enquiry, e.id, sp));
      expect(remove.threw).toBe(true);
    });
  });

  it("still refuses him adding anything on any other table", async () => {
    await inRollback(async (tx) => {
      const { appUser } = await import("@/db/schema");
      await expect(
        auditedInsert(
          await amit(tx),
          appUser,
          { username: uniq("u"), name: "Not this", role: "FLOOR" },
          tx,
        ),
      ).rejects.toBeInstanceOf(ReadOnlyRoleError);
    });
  });
});
