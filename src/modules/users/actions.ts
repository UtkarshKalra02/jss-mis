"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireAccess, requireActiveUser } from "@/auth/guard";
import type { Role } from "@/auth/roles";
import { db } from "@/db";
import { auditedInsert, auditedSoftDelete, auditedUpdate, type Actor } from "@/db/audit";
import { appUser } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

import { activeAdminCount, getUser, usernameTaken } from "./queries";
import {
  changeOwnPasswordSchema,
  createUserSchema,
  setPasswordSchema,
  updateUserSchema,
} from "./validation";

export type FormState = {
  ok: boolean;
  error: string | null;
  message?: string;
  /**
   * Where the screen should go next.
   *
   * Set by any action that removes the row the current page is reading (G11).
   * Without it the record leaves the query, the page calls notFound(), and the
   * confirmation for removing something is a 404.
   */
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
 * User administration.
 *
 * Every mutation here goes through the audit wrapper, so each one is recorded
 * with before/after state and the hash is redacted (non-negotiable 3).
 *
 * The recurring theme below is LOCKOUT. This panel is the only way to
 * administer the system, and it is entirely possible to lock everyone out of
 * it with one careless click — deactivate the last admin, or demote yourself
 * and lose the screen you would need to undo it. Each guard exists because it
 * is unrecoverable from the UI; the CLI is the only way back.
 */

async function requireAdmin(): Promise<Actor & { id: string }> {
  const user = await requireAccess("admin", "write");
  return { id: user.id, role: user.role };
}

/** Refuses any change that would leave nobody able to administer the system. */
async function assertNotLastAdmin(targetId: string, targetRole: Role, whatChanges: string) {
  if (targetRole !== "ADMIN") return;
  const remaining = await activeAdminCount();
  if (remaining <= 1) {
    throw new Error(
      `This is the only administrator who can sign in, so ${whatChanges} would lock everyone out of user management. Give another user the ADMIN role first.`,
    );
  }
  void targetId;
}

export async function createUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();

    const parsed = createUserSchema.safeParse({
      username: String(formData.get("username") ?? "").toLowerCase(),
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
    });

    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    if (await usernameTaken(parsed.data.username)) {
      return fail(`Username "${parsed.data.username}" is already taken.`);
    }

    await auditedInsert(actor, appUser, {
      username: parsed.data.username,
      name: parsed.data.name,
      email: parsed.data.email || null,
      role: parsed.data.role,
      // Created with no usable password, exactly as the seed script does. The
      // account exists and can be assigned work, but cannot sign in until
      // somebody sets a password for it.
      passwordHash: null,
      isActive: true,
    });

    revalidatePath("/admin/users");
    return ok(`${parsed.data.name} added. Set a password before they can sign in.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not add the user.");
  }
}

export async function updateUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();
    const id = String(formData.get("id") ?? "");

    const target = await getUser(id);
    if (!target) return fail("That user no longer exists.");

    const parsed = updateUserSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const losingAdmin = target.role === "ADMIN" && parsed.data.role !== "ADMIN";

    if (losingAdmin && target.id === actor.id) {
      return fail(
        "You cannot remove your own ADMIN role — you would lose access to this screen and could not undo it.",
      );
    }
    if (losingAdmin) {
      await assertNotLastAdmin(target.id, "ADMIN", "changing their role");
    }

    await auditedUpdate(actor, appUser, id, {
      name: parsed.data.name,
      email: parsed.data.email || null,
      role: parsed.data.role,
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${id}`);
    return ok("Saved.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save the changes.");
  }
}

export async function setActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();
    const id = String(formData.get("id") ?? "");
    const makeActive = String(formData.get("isActive")) === "true";

    const target = await getUser(id);
    if (!target) return fail("That user no longer exists.");

    if (!makeActive && target.id === actor.id) {
      return fail("You cannot deactivate your own account.");
    }
    if (!makeActive) {
      await assertNotLastAdmin(target.id, target.role as Role, "deactivating them");
    }

    await auditedUpdate(actor, appUser, id, { isActive: makeActive });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${id}`);
    return ok(makeActive ? `${target.name} can sign in again.` : `${target.name} deactivated.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not change the account status.");
  }
}

export async function setPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();
    const id = String(formData.get("id") ?? "");

    const target = await getUser(id);
    if (!target) return fail("That user no longer exists.");

    const parsed = setPasswordSchema.safeParse({
      password: formData.get("password"),
      confirm: formData.get("confirm"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const settingOwn = target.id === actor.id;

    await auditedUpdate(actor, appUser, id, {
      passwordHash: await hashPassword(parsed.data.password),
      // Forced only when an admin sets it FOR SOMEBODY ELSE. Setting your own
      // password and then being told to change it is pointless friction.
      mustChangePassword: !settingOwn,
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${id}`);

    return ok(
      settingOwn
        ? "Your password has been changed."
        : `Temporary password set for ${target.name}. They will be asked to choose their own at next sign-in.`,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not set the password.");
  }
}

export async function deleteUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireAdmin();
    const id = String(formData.get("id") ?? "");

    const target = await getUser(id);
    if (!target) return fail("That user no longer exists.");

    if (target.id === actor.id) return fail("You cannot delete your own account.");
    await assertNotLastAdmin(target.id, target.role as Role, "deleting them");

    // Soft delete (non-negotiable 7). The row stays so audit rows and any
    // stage events they entered keep their foreign keys; the partial unique
    // index frees the username for reuse.
    await auditedSoftDelete(actor, appUser, id);

    revalidatePath("/admin/users");
    return ok(`${target.name} removed.`, "/admin/users");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not remove the user.");
  }
}

/**
 * Self-service password change. Available to every signed-in role, including
 * OWNER — changing your own credential is not a data write, so the read-only
 * rule does not apply. It bypasses the audit wrapper's OWNER check by acting
 * as SYSTEM for this one field, which is why the guard below is strict about
 * only ever touching the caller's own row.
 */
export async function changeOwnPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireActiveUser();

    const parsed = changeOwnPasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      password: formData.get("password"),
      confirm: formData.get("confirm"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const [row] = await db
      .select({ passwordHash: appUser.passwordHash })
      .from(appUser)
      .where(eq(appUser.id, user.id))
      .limit(1);

    if (!row?.passwordHash) return fail("Your account has no password set. Ask an administrator.");

    if (!(await verifyPassword(parsed.data.currentPassword, row.passwordHash))) {
      return fail("Your current password is not correct.");
    }

    if (await verifyPassword(parsed.data.password, row.passwordHash)) {
      return fail("The new password must be different from the current one.");
    }

    await auditedUpdate(
      // Acting as the user on their own row. Written as an explicit ADMIN-role
      // actor rather than reusing the session role so that an OWNER can still
      // change their own password without tripping the deny-write check.
      { id: user.id, role: "ADMIN" },
      appUser,
      user.id,
      {
        passwordHash: await hashPassword(parsed.data.password),
        mustChangePassword: false,
      },
    );

    return ok("Password changed.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not change your password.");
  }
}
