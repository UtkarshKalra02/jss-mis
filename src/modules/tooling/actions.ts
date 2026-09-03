"use server";

import { eq, isNull, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor } from "@/db/audit";
import { tooling } from "@/db/schema";
import { allocateNumber } from "@/lib/numbering";

import { getToolingRecord } from "./queries";
import { parseToolingForm, TOOL_TYPE_PREFIX } from "./validation";

/**
 * Job Kitting register writes.
 *
 * ORDER_DESK and ADMIN only — Punit owns this register (I9). Everybody else
 * reads it, including FLOOR, because looking up where a die is kept from a
 * phone is exactly the mobile case.
 *
 * THERE IS NO ISSUE/RETURN WORKFLOW (I5). `status` is an ordinary field somebody
 * sets. A checkout system was explicitly excluded: it is a daily-discipline
 * burden nobody agreed to carry, and a half-kept one is worse than none because
 * it still reads as authoritative.
 */

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  /** Set when the action makes the current page unreachable (G11). */
  redirectTo?: string;
};

const ok = (message?: string, redirectTo?: string): FormState => ({
  ok: true,
  error: null,
  message,
  redirectTo,
});
const fail = (error: string): FormState => ({ ok: false, error });

/**
 * Where to send somebody after removing the row the page was showing.
 *
 * A SERVER REDIRECT, not a destination returned to the client (J13). The
 * earlier fix returned `redirectTo` and let a useEffect push to it, and that
 * loses a race it cannot win: a server action re-renders the current route
 * before the client effect commits, the page calls notFound() against a row
 * that has just gone, and the confirmation for removing something is a 404.
 * Returning the destination only made the 404 shorter.
 *
 * `redirect()` works by throwing, which is why G11 avoided it — every one of
 * these actions has a try/catch that would report the successful removal as a
 * failure. `unstable_rethrow` in the catch is the answer to that: it lets
 * Next's own control-flow errors through and leaves real errors to be handled.
 *
 * The message rides in the query string, and the app shell turns it into a
 * toast, so the confirmation survives the navigation.
 */
function removedTo(path: string, message: string): never {
  redirect(`${path}?removed=${encodeURIComponent(message)}`);
}

async function requireToolingWriter(): Promise<Actor> {
  const user = await requireAccess("tooling", "write");
  return { id: user.id, role: user.role };
}

function revalidate(id?: string, designId?: string | null) {
  revalidatePath("/tooling");
  if (id) revalidatePath(`/tooling/${id}`);
  if (designId) revalidatePath(`/designs/${designId}`);
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Adds a tool to the register.
 *
 * The number's PREFIX comes from the type (I2), and its financial year from the
 * made date when there is one — a die cut last March belongs to last year's
 * series whether it is entered that week or a year later (F10). Allocation
 * happens inside the same transaction as the insert, so a failed save does not
 * burn a number (C7).
 *
 * `clientId` is posted but not trusted: when a design is linked, the database
 * trigger overwrites it from the design (I3). Sending it anyway keeps the form
 * simple for tooling with no design.
 */
export async function createToolingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireToolingWriter();

    const parsed = parseToolingForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    const row = await db.transaction(async (tx) =>
      auditedInsert(
        actor,
        tooling,
        {
          // The made date still decides the number's financial year (I2, F10)
          // even though the form no longer asks for it — it falls back to
          // today, which is right for a tool being entered as it is made.
          toolNo: await allocateNumber(tx, TOOL_TYPE_PREFIX[v.toolType], v.madeDate),
          toolType: v.toolType,
          name: v.name,
          location: v.location ?? null,
          vendor: v.vendor ?? null,
          size: v.size ?? null,
          colour: v.colour ?? null,
          ink: v.ink ?? null,
          pantoneNo: v.pantoneNo ?? null,
          condition: v.condition,
          status: v.status,
          designId: v.designId ?? null,
          clientId: v.clientId ?? null,
          replacesToolId: v.replacesToolId ?? null,
          remarks: v.remarks ?? null,
        },
        tx,
      ),
    );

    revalidate(row.id, row.designId);
    return ok(`${row.toolNo} added.`, `/tooling/${row.id}`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not add that tool.");
  }
}

/* -------------------------------------------------------------------------- */
/* Update                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Edits a tool.
 *
 * The tool NUMBER is never reissued, even when the type changes. It is written
 * on a label stuck to the metal, and renumbering after the fact is how the
 * shelf and the screen stop agreeing (C7). A tool entered under the wrong type
 * keeps its number and gains a corrected type, which is the honest record.
 */
export async function updateToolingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireToolingWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getToolingRecord(id);
    if (!existing) return fail("That tool is no longer in the register.");

    const parsed = parseToolingForm(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    // The database CHECK refuses this too; the message here is a sentence.
    if (v.replacesToolId === id) {
      return fail("A tool cannot replace itself.");
    }

    /*
     * Provenance — made date, cost, impressions, last used — is deliberately
     * NOT in this payload (I10). The form stopped offering those fields, so
     * `v.madeDate ?? null` would blank a cost somebody typed before the
     * section was removed, on every subsequent edit. The columns keep whatever
     * they hold; nothing writes them.
     *
     * VENDOR IS THE EXCEPTION and is written, because the Ordered status needs
     * it: a tool on order from nobody in particular is half a record (I11).
     */
    await auditedUpdate(actor, tooling, id, {
      toolType: v.toolType,
      name: v.name,
      location: v.location ?? null,
      // Vendor only. The other four provenance columns are still not written
      // by this action — see the note above (I10, I11).
      vendor: v.vendor ?? null,
      size: v.size ?? null,
      colour: v.colour ?? null,
      ink: v.ink ?? null,
      pantoneNo: v.pantoneNo ?? null,
      condition: v.condition,
      status: v.status,
      designId: v.designId ?? null,
      clientId: v.clientId ?? null,
      replacesToolId: v.replacesToolId ?? null,
      remarks: v.remarks ?? null,
    });

    revalidate(id, v.designId ?? existing.designId);
    return ok("Saved.");
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not save those changes.");
  }
}

/* -------------------------------------------------------------------------- */
/* Remove                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Removes a tool from the register (soft delete, non-negotiable 7).
 *
 * For one entered by mistake. A tool that physically no longer exists is
 * `Scrapped` or `Lost` instead — those are facts about the metal and belong in
 * the record, where removal says the ROW should never have been typed.
 *
 * Refused while another tool names this one as its predecessor: removing it
 * would leave that chain pointing at a row nothing displays, which is the same
 * orphan shape the press run and import undo both avoid.
 */
export async function removeToolingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireToolingWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getToolingRecord(id);
    if (!existing) return fail("That tool is no longer in the register.");

    const successors = await db
      .select({ toolNo: tooling.toolNo })
      .from(tooling)
      .where(and(eq(tooling.replacesToolId, id), isNull(tooling.deletedAt)));

    const live = successors;
    if (live.length > 0) {
      return fail(
        `${live.map((s) => s.toolNo).join(", ")} record${live.length === 1 ? "s" : ""} this tool as what ${live.length === 1 ? "it" : "they"} replaced. Clear that first, or mark this one Scrapped instead of removing it.`,
      );
    }

    await auditedSoftDelete(actor, tooling, id);

    revalidate(id, existing.designId);
    removedTo("/tooling", `${existing.toolNo} removed from the register.`);
  } catch (error) {
    unstable_rethrow(error);
    return fail(error instanceof Error ? error.message : "Could not remove that tool.");
  }
}
