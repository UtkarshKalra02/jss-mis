import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SYSTEM_USER_ID, type Actor } from "@/db/audit";
import { resolveClientId } from "@/modules/clients/resolve";

import { inRollback, uniq } from "./helpers";

/**
 * Turning a typed client name into a client id (K13, extended by K19).
 *
 * The rule pinned here is WHO MAY BRING A CLIENT INTO BEING. It is gated on
 * the `client` resource rather than on whichever document the caller happens
 * to be filling in — which is the bug K19 fixed: the enquiry picker checked
 * nothing, so anybody who could raise an enquiry could create a client while
 * the role matrix said only ADMIN could.
 *
 * Run against the real database because the matching, the code allocation and
 * the audited insert all happen in SQL, and a mock would be testing the mock.
 */

const actorOf = (role: Actor["role"]): Actor => ({ id: SYSTEM_USER_ID, role });

describe("resolving a typed client name", () => {
  it("uses an existing client when the name matches after normalising", async () => {
    await inRollback(async (tx) => {
      const name = uniq("Natureexpert Ayurvedic ");
      const [existing] = (
        await tx.execute(
          sql`insert into client (code, name) values (${uniq("NAT")}, ${name}) returning id`,
        )
      ).rows as { id: string }[];

      // Typed with a legal suffix the master does not carry. The importer's
      // matcher strips it, so this is the same customer, not a new one.
      const result = await resolveClientId(tx, actorOf("ADMIN"), {
        clientName: `${name} Pvt Ltd`,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.clientId).toBe(existing!.id);
        expect(result.created).toBe(false);
      }
    });
  });

  it("creates one for a role that may write clients", async () => {
    await inRollback(async (tx) => {
      const name = uniq("Brand New Customer ");

      // ORDER_DESK gained client write in K19 — this is the capability that
      // change was actually about.
      const result = await resolveClientId(tx, actorOf("ORDER_DESK"), { clientName: name });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.created).toBe(true);

        const [row] = (
          await tx.execute(sql`select name, code from client where id = ${result.clientId}`)
        ).rows as { name: string; code: string }[];

        // Stored exactly as typed. Normalising is for comparing; what somebody
        // wrote is what the client master shows.
        expect(row!.name).toBe(name);
        expect(row!.code.length).toBeGreaterThan(0);
      }
    });
  });

  it("refuses to create one for a role that may only read clients", async () => {
    await inRollback(async (tx) => {
      // PLANNER has enquiry write and client read. Before K19 this succeeded,
      // because the check keyed off the document rather than the resource.
      const result = await resolveClientId(tx, actorOf("PLANNER"), {
        clientName: uniq("Should Not Exist "),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The message has to say what to do next, not name a permission.
        expect(result.error).toContain("cannot create one");
      }
    });
  });

  it("lets a read-only role still CHOOSE an existing client", async () => {
    await inRollback(async (tx) => {
      const name = uniq("Existing Customer ");
      const [existing] = (
        await tx.execute(
          sql`insert into client (code, name) values (${uniq("EXC")}, ${name}) returning id`,
        )
      ).rows as { id: string }[];

      // Choosing is not creating, so the gate must not catch this.
      const result = await resolveClientId(tx, actorOf("PLANNER"), {
        clientId: existing!.id,
        clientName: name,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.created).toBe(false);
    });
  });

  it("refuses a near match rather than guessing, whoever is asking", async () => {
    await inRollback(async (tx) => {
      const base = uniq("Kaya Beauty Care ");
      await tx.execute(
        sql`insert into client (code, name) values (${uniq("KBC")}, ${base})`,
      );

      // Close but not equal. Guessing here is how orders get attached to the
      // wrong customer, so an ADMIN is refused exactly as anybody else is.
      const result = await resolveClientId(tx, actorOf("ADMIN"), {
        clientName: `${base} Products`,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("close to an existing client");
    });
  });
});
