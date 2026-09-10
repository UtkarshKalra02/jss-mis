import { eq, isNull, asc } from "drizzle-orm";

import { db } from "@/db";
import { auditedInsert, type Actor, type Tx } from "@/db/audit";
import { client } from "@/db/schema";
import { can } from "@/auth/roles";
import { buildClientIndex, clientCodeFor, matchClient } from "@/modules/imports/match";
import { liveClientCodes } from "@/modules/imports/queries";

/**
 * Turning a typed client name into a client id — for every screen that does it.
 *
 * ONE IMPLEMENTATION, deliberately. The enquiry register got this first (K13)
 * and the design master needs exactly the same behaviour (K19); a second copy
 * would be a second answer to "are these the same company", which is the thing
 * F31 already argued once when the importer's matcher was written.
 *
 * The matching itself is the importer's, called rather than reimplemented, so
 * "NATUREEXPERT AYURVEDIC PVT LTD" and "Natureexpert Ayurvedic" resolve to one
 * customer here exactly as they do in an upload.
 */

export type ClientResolution =
  | { ok: true; clientId: string; created: boolean }
  | { ok: false; error: string };

/** Every live client, in the shape the importer's matcher expects. */
export async function listClientsForMatching(
  runner: typeof db | Tx = db,
): Promise<{ id: string; code: string; name: string }[]> {
  return runner
    .select({ id: client.id, code: client.code, name: client.name })
    .from(client)
    .where(isNull(client.deletedAt))
    .orderBy(asc(client.name));
}

/**
 * Resolves what a form said about the client into an id.
 *
 * THE MATCHING IS RE-RUN HERE, against live rows, even when the picker already
 * resolved an id in the browser. That copy of the client list was loaded when
 * the page was, and somebody else may have created the same customer in the
 * minutes since — which is exactly how a client master grows two rows for one
 * customer.
 *
 * Behaviour by outcome, mirroring the importer's (F32):
 *
 *   matched   — used silently. An exact match after normalising is not a
 *               question worth asking.
 *   create    — a client is created, IF the actor may create one. See below.
 *   review    — REFUSED. Something resembles it, and guessing is how orders
 *               get attached to the wrong customer. The picker asks this in
 *               the browser; reaching here means the answer went stale.
 *   ambiguous — refused for the same reason, more so.
 *
 * CREATION IS GATED ON THE `client` RESOURCE, not on whichever document the
 * caller happens to be filling in. That distinction is the whole point of this
 * function existing: when the enquiry picker checked nothing, anyone who could
 * raise an enquiry could create a client, and the role matrix said otherwise
 * (K19). Here the matrix is the single source of truth, so ADMIN and
 * ORDER_DESK create clients wherever they are standing, and PLANNER and
 * ACCOUNTS are told to pick an existing one — on the enquiry screen and the
 * design screen alike, because it is one rule rather than a screen's opinion.
 *
 * An explicitly chosen id is honoured without re-matching and without the
 * permission check, because choosing an existing client is not creating one.
 */
export async function resolveClientId(
  tx: Tx,
  actor: Actor,
  input: { clientId?: string; clientName: string },
): Promise<ClientResolution> {
  if (input.clientId) {
    const [chosen] = await tx
      .select({ id: client.id })
      .from(client)
      .where(eq(client.id, input.clientId));

    if (chosen) return { ok: true, clientId: chosen.id, created: false };
    // Chosen and then deleted. Fall through and match the name instead of
    // failing on an id nobody can act on.
  }

  const clients = await listClientsForMatching(tx);
  const match = matchClient(input.clientName, buildClientIndex(clients));

  if (match.kind === "matched") {
    return { ok: true, clientId: match.client.id, created: false };
  }

  if (match.kind === "review" || match.kind === "ambiguous") {
    const names = match.candidates.map((c) => `${c.code} — ${c.name}`).join(", ");
    return {
      ok: false,
      error:
        match.kind === "ambiguous"
          ? `Two existing clients match that name (${names}). Choose one.`
          : `That name is close to an existing client (${names}). Choose one, or change the name if it really is somebody new.`,
    };
  }

  if (!can(actor.role, "client", "write")) {
    return {
      ok: false,
      error: `“${input.clientName}” is not a client yet, and your role cannot create one. Choose an existing client, or ask an admin to add them first.`,
    };
  }

  const taken = await liveClientCodes(tx);
  const created = await auditedInsert(
    actor,
    client,
    {
      // The name is stored exactly as it was typed. Normalising is for
      // comparing; what somebody wrote is what the client master shows.
      code: clientCodeFor(input.clientName, taken),
      name: input.clientName,
    },
    tx,
  );

  return { ok: true, clientId: created.id, created: true };
}
