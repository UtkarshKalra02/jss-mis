"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import type { Actor } from "@/db/audit";

import { ImportParseError, parseWorkbook } from "./parse";
import { existingDedupeKeys, getImportBatch, listClientsForImport } from "./queries";
import {
  importableRows,
  validateRows,
  type ClientDecisions,
  type ClientLookup,
  type RawRow,
} from "./validate";
import { undoImportBatch, writeImportBatch } from "./write";

/**
 * What "check the file" produces: the INPUTS to validation, not its verdict.
 *
 * The screen runs validateRows() itself, because a review decision (F32)
 * changes the answer for every row sharing that client name and the counts
 * above the grid have to follow. Returning the verdict instead would mean a
 * round trip per click, or a second implementation of the rules in the
 * browser — and the moment two implementations exist, one of them is wrong.
 *
 * Nothing here is trusted on the way back: confirm re-validates server-side
 * against freshly read lookups (F30).
 */
export type PreviewState = {
  ok: boolean;
  error: string | null;
  filename?: string;
  rows?: RawRow[];
  clients?: ClientLookup[];
  existingKeys?: string[];
};

export type ConfirmState = {
  ok: boolean;
  error: string | null;
  message?: string;
};

/**
 * Review answers as they arrive from the form: normalised client name to
 * either a client id or "new".
 *
 * Parsed defensively — this comes back through the browser, and a malformed
 * one must produce an import with unanswered rows left out rather than an
 * exception on a screen somebody cannot act on. Every value is re-checked
 * inside validateRows anyway: a decision naming a client that no longer exists
 * falls back to review, which stops the row.
 */
function parseDecisions(raw: FormDataEntryValue | null): ClientDecisions {
  if (typeof raw !== "string" || raw.length === 0) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, value]) => typeof value === "string",
      ),
    ) as ClientDecisions;
  } catch {
    return {};
  }
}

/** Decision F28: ADMIN and ORDER_DESK. */
async function requireImporter(): Promise<Actor> {
  const user = await requireAccess("import", "write");
  return { id: user.id, role: user.role };
}

/* -------------------------------------------------------------------------- */
/* Preview — nothing is written                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parses and validates an uploaded file WITHOUT writing anything.
 *
 * The requirement is that a person sees a row-by-row verdict before any of it
 * lands. This action is the whole of that promise: it touches no table, and the
 * only database access is reading the lookups the validator needs.
 */
export async function previewImportAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  try {
    await requireImporter();

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a file to upload." };
    }

    const rows = await parseWorkbook(await file.arrayBuffer());

    const [clients, existingKeys] = await Promise.all([
      listClientsForImport(),
      existingDedupeKeys(),
    ]);

    return {
      ok: true,
      error: null,
      filename: file.name,
      rows,
      clients,
      existingKeys: [...existingKeys],
    };
  } catch (error) {
    // A parse error is a statement about the FILE and is shown as-is. Anything
    // else is a statement about US, and belongs in the log with its stack
    // rather than being paraphrased at somebody who cannot act on it.
    if (error instanceof ImportParseError) return { ok: false, error: error.message };

    console.error("[import] preview failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read that file.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Confirm — one transaction                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Writes an approved preview.
 *
 * The rows arrive back from the browser as the raw strings that were parsed,
 * and are RE-VALIDATED here against fresh lookups. That is not belt and braces:
 * the preview travelled through the client, the database may have changed since
 * it was produced, and only rows this pass accepts are written. Trusting the
 * verdict that came back would let anything be posted in.
 *
 * Everything lands in ONE transaction (the requirement says so). A part-written
 * import is worse than a failed one: nobody knows how far it got, and re-running
 * it duplicates whatever did land.
 */
export async function confirmImportAction(
  _prev: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  try {
    const actor = await requireImporter();

    const filename = String(formData.get("filename") ?? "import.xlsx");
    const payload = String(formData.get("rows") ?? "");
    if (!payload) return { ok: false, error: "Nothing to import — upload the file again." };

    let rows: RawRow[];
    try {
      rows = JSON.parse(payload) as RawRow[];
    } catch {
      return { ok: false, error: "That preview could not be read. Upload the file again." };
    }

    const [clients, existingKeys] = await Promise.all([
      listClientsForImport(),
      existingDedupeKeys(),
    ]);

    const decisions = parseDecisions(formData.get("decisions"));
    const result = validateRows(rows, { clients, existingKeys, decisions });
    const toWrite = importableRows(result);

    if (toWrite.length === 0) {
      return { ok: false, error: "No rows are importable. Fix the file and upload it again." };
    }

    const counts = await db.transaction((tx) =>
      writeImportBatch(actor, tx, { filename, result }),
    );

    revalidatePath("/purchase-orders/import");
    revalidatePath("/purchase-orders");
    revalidatePath("/items");
    revalidatePath("/dispatch");
    revalidatePath("/clients");

    // Rows whose client is still in doubt are not written (F32), so an import
    // can legitimately land with some rows left behind. The message says so,
    // rather than reporting a clean success over a file two-thirds imported.
    return {
      ok: true,
      error: null,
      message:
        `Imported ${counts.imported} job${counts.imported === 1 ? "" : "s"}` +
        (counts.completed > 0 ? `, ${counts.completed} fully delivered` : "") +
        (counts.clientsCreated > 0
          ? `. ${counts.clientsCreated} new client${counts.clientsCreated === 1 ? "" : "s"} created — check them on the Clients screen`
          : "") +
        (counts.skipped > 0 ? `. ${counts.skipped} skipped as already present` : "") +
        (result.summary.review > 0
          ? `. ${result.summary.review} row${result.summary.review === 1 ? " was" : "s were"} left out, still waiting on a client decision`
          : "") +
        ".",
    };
  } catch (error) {
    console.error("[import] confirm failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not import that file.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Undo                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Reverses a batch.
 *
 * SOFT DELETE, and it cannot be anything else: stage_event is append-only, so
 * the PO_RECEIVED and DISPATCHED events the batch wrote cannot be removed.
 * Soft-deleting the po_item rows takes them out of v_po_item_status and every
 * view built on it, leaving those events attached to rows nothing displays.
 * That is the right outcome — what was entered and then withdrawn is exactly
 * what an audit trail is for.
 *
 * Only rows CARRYING this batch's id are touched. A purchase order the batch
 * attached to but did not create has a null import_batch_id and survives, along
 * with whatever else is on it.
 */
export async function undoImportAction(
  _prev: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  try {
    const actor = await requireImporter();
    const batchId = String(formData.get("batchId") ?? "");

    const batch = await getImportBatch(batchId);
    if (!batch) return { ok: false, error: "That import no longer exists." };
    if (batch.undoneAt) return { ok: false, error: "That import has already been undone." };

    const removed = await db.transaction((tx) => undoImportBatch(actor, tx, batchId));

    revalidatePath("/purchase-orders/import");
    revalidatePath("/purchase-orders");
    revalidatePath("/items");
    revalidatePath("/dispatch");
    revalidatePath("/clients");

    return {
      ok: true,
      error: null,
      message:
        `Undone. ${removed.items} item${removed.items === 1 ? "" : "s"}, ${removed.orders} purchase order${removed.orders === 1 ? "" : "s"} and ${removed.challans} challan${removed.challans === 1 ? "" : "s"} removed` +
        (removed.clients > 0
          ? `, along with ${removed.clients} client${removed.clients === 1 ? "" : "s"} this import created`
          : "") +
        ".",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not undo that import.",
    };
  }
}
