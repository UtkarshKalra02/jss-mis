"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/auth/guard";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor } from "@/db/audit";
import { client } from "@/db/schema";

import { clientCodeTaken, getClient } from "./queries";
import { clientSchema } from "./validation";

export type FormState = { ok: boolean; error: string | null; message?: string };

const ok = (message?: string): FormState => ({ ok: true, error: null, message });
const fail = (error: string): FormState => ({ ok: false, error });

/**
 * Client master writes.
 *
 * Access follows decision A3: ADMIN creates, edits and deactivates; the desk
 * roles read only. That is enforced by requireAccess("client", "write") here,
 * not by hiding the buttons — a PLANNER who posts this form directly still
 * gets refused.
 */
async function requireClientWriter(): Promise<Actor> {
  const user = await requireAccess("client", "write");
  return { id: user.id, role: user.role };
}

function parse(formData: FormData) {
  return clientSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    gstin: formData.get("gstin"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    city: formData.get("city"),
    state: formData.get("state"),
    pincode: formData.get("pincode"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
    paymentTermsDays: formData.get("paymentTermsDays"),
    creditLimit: formData.get("creditLimit"),
    clientType: formData.get("clientType"),
  });
}

/** Empty form fields arrive as "" — store NULL so "unknown" stays distinct. */
const orNull = (v: string | undefined) => (v && v.length > 0 ? v : null);

export async function createClientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireClientWriter();

    const parsed = parse(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    if (await clientCodeTaken(v.code)) {
      return fail(`Code "${v.code}" is already used by another client.`);
    }

    await auditedInsert(actor, client, {
      code: v.code,
      name: v.name,
      gstin: orNull(v.gstin),
      addressLine1: orNull(v.addressLine1),
      addressLine2: orNull(v.addressLine2),
      city: orNull(v.city),
      state: orNull(v.state),
      pincode: orNull(v.pincode),
      contactName: orNull(v.contactName),
      contactPhone: orNull(v.contactPhone),
      contactEmail: orNull(v.contactEmail),
      paymentTermsDays: v.paymentTermsDays,
      creditLimit: v.creditLimit === "" || v.creditLimit === undefined ? null : String(v.creditLimit),
      clientType: v.clientType,
      isActive: true,
    });

    revalidatePath("/clients");
    return ok(`${v.name} added.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not add the client.");
  }
}

export async function updateClientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireClientWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getClient(id);
    if (!existing) return fail("That client no longer exists.");

    const parsed = parse(formData);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    if (await clientCodeTaken(v.code, id)) {
      return fail(`Code "${v.code}" is already used by another client.`);
    }

    await auditedUpdate(actor, client, id, {
      code: v.code,
      name: v.name,
      gstin: orNull(v.gstin),
      addressLine1: orNull(v.addressLine1),
      addressLine2: orNull(v.addressLine2),
      city: orNull(v.city),
      state: orNull(v.state),
      pincode: orNull(v.pincode),
      contactName: orNull(v.contactName),
      contactPhone: orNull(v.contactPhone),
      contactEmail: orNull(v.contactEmail),
      paymentTermsDays: v.paymentTermsDays,
      creditLimit: v.creditLimit === "" || v.creditLimit === undefined ? null : String(v.creditLimit),
      clientType: v.clientType,
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${id}`);
    return ok("Saved.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the changes.");
  }
}

export async function setClientActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireClientWriter();
    const id = String(formData.get("id") ?? "");
    const makeActive = String(formData.get("isActive")) === "true";

    const existing = await getClient(id);
    if (!existing) return fail("That client no longer exists.");

    await auditedUpdate(actor, client, id, { isActive: makeActive });

    revalidatePath("/clients");
    revalidatePath(`/clients/${id}`);
    return ok(
      makeActive
        ? `${existing.name} is active again.`
        : `${existing.name} deactivated — they stay on existing orders but cannot be chosen for new ones.`,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not change the status.");
  }
}

/**
 * Marks an auto-created client as checked (decision F32).
 *
 * The importer can now create a client where nothing on file resembled the name
 * in the spreadsheet. What it creates is a name and a generated code and
 * nothing else — no GSTIN, no address, no payment terms beyond the default —
 * so it is a record somebody has to finish, and the client list can filter to
 * exactly those. This is how one leaves that list.
 *
 * It does NOT clear import_batch_id. That is the fact of where the row came
 * from and stays true forever; it is also what the batch's undo keys on, and
 * clearing it would quietly take the client out of an undo that is still
 * offered on the Import History screen.
 */
export async function markClientReviewedAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireClientWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getClient(id);
    if (!existing) return fail("That client no longer exists.");
    if (!existing.importBatchId) return fail("That client was not created by an import.");

    await auditedUpdate(actor, client, id, {
      importReviewedAt: new Date(),
      importReviewedBy: actor.id,
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${id}`);
    return ok(`${existing.name} marked as checked.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not mark it as checked.");
  }
}

export async function deleteClientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireClientWriter();
    const id = String(formData.get("id") ?? "");

    const existing = await getClient(id);
    if (!existing) return fail("That client no longer exists.");

    // Soft delete. Purchase orders, dispatches and invoices keep pointing at
    // this row, so history stays intact; the partial unique index releases the
    // code for reuse.
    await auditedSoftDelete(actor, client, id);

    revalidatePath("/clients");
    return ok(`${existing.name} removed.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not remove the client.");
  }
}
