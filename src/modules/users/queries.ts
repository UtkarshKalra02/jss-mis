import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { SYSTEM_USER_ID } from "@/db/audit";
import { db } from "@/db";
import { appUser } from "@/db/schema";

/**
 * Reads for the user admin panel.
 *
 * The SYSTEM account is excluded everywhere. It exists only so machine writes
 * have something to attribute themselves to; showing it in a list of people
 * invites somebody to try to edit or delete it.
 */

const notSystem = ne(appUser.id, SYSTEM_USER_ID);

export type UserRow = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
};

export async function listUsers(includeDeleted = false): Promise<UserRow[]> {
  const rows = await db
    .select({
      id: appUser.id,
      username: appUser.username,
      name: appUser.name,
      email: appUser.email,
      role: appUser.role,
      isActive: appUser.isActive,
      // Never select password_hash into application memory when its value is
      // not needed. Whether one EXISTS is all the panel has to know.
      hasPassword: sql<boolean>`${appUser.passwordHash} is not null`,
      mustChangePassword: appUser.mustChangePassword,
      lastLoginAt: appUser.lastLoginAt,
    })
    .from(appUser)
    .where(includeDeleted ? notSystem : and(notSystem, isNull(appUser.deletedAt)))
    .orderBy(asc(appUser.name));

  return rows;
}

export async function getUser(id: string): Promise<UserRow | null> {
  const [row] = await db
    .select({
      id: appUser.id,
      username: appUser.username,
      name: appUser.name,
      email: appUser.email,
      role: appUser.role,
      isActive: appUser.isActive,
      hasPassword: sql<boolean>`${appUser.passwordHash} is not null`,
      mustChangePassword: appUser.mustChangePassword,
      lastLoginAt: appUser.lastLoginAt,
    })
    .from(appUser)
    .where(and(eq(appUser.id, id), notSystem, isNull(appUser.deletedAt)))
    .limit(1);

  return row ?? null;
}

/**
 * How many ADMINs could actually sign in right now.
 *
 * Used by the lockout guards. An ADMIN who cannot authenticate is not a way
 * back into the system, so accounts with no password do not count — otherwise
 * "there is another admin" could be true while nobody can actually get in.
 */
export async function activeAdminCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appUser)
    .where(
      and(
        eq(appUser.role, "ADMIN"),
        eq(appUser.isActive, true),
        isNull(appUser.deletedAt),
        notSystem,
        sql`${appUser.passwordHash} is not null`,
      ),
    );

  return row?.n ?? 0;
}

export async function usernameTaken(username: string, excludeId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(
      excludeId
        ? and(eq(appUser.username, username), isNull(appUser.deletedAt), ne(appUser.id, excludeId))
        : and(eq(appUser.username, username), isNull(appUser.deletedAt)),
    )
    .limit(1);

  return Boolean(row);
}
