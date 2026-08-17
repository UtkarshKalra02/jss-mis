import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { appUser } from "@/db/schema";

import { currentUser } from "./index";
import { can, type Access, type Resource, type Role } from "./roles";

export type ActiveUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
};

/**
 * Re-reads the signed-in user from the database.
 *
 * The session is a JWT, because Auth.js does not support database sessions
 * with the credentials provider. That means the role and the account status
 * inside it are a SNAPSHOT taken at sign-in, and stay frozen for the life of
 * the token — up to eight hours here.
 *
 * Trusting that snapshot has consequences that are unacceptable for an
 * internal system where access changes are a normal administrative act:
 * deactivating someone would not take effect until their token expired, and
 * demoting a role would leave the old permissions live for the rest of the
 * day. Both fail open, and neither is visible to whoever made the change.
 *
 * So every guarded page pays one indexed lookup to ask the database who this
 * person is NOW. That is the cost of making "deactivate this account" mean
 * what it says.
 */
async function readActiveUser(): Promise<ActiveUser | null> {
  const session = await currentUser();
  if (!session) return null;

  const [row] = await db
    .select({
      id: appUser.id,
      username: appUser.username,
      name: appUser.name,
      role: appUser.role,
      isActive: appUser.isActive,
    })
    .from(appUser)
    .where(and(eq(appUser.id, session.id), isNull(appUser.deletedAt)))
    .limit(1);

  // Deleted, deactivated, or an id that no longer resolves — all mean the
  // token outlived the account it describes.
  if (!row || !row.isActive) return null;

  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

/**
 * The guard every protected page and server action starts with.
 *
 * requireUser() alone is NOT enough — it proves somebody is signed in, not
 * that they are allowed on this screen. A page that only calls requireUser()
 * is reachable by any authenticated user who types the URL, regardless of what
 * the role matrix says. That is how a screen ends up hidden from the sidebar
 * but open to everyone, which is what happened with FLOOR and /dashboard.
 *
 * Returns the user so callers get authentication, freshness, and authorization
 * in one line, leaving no reason to reach for a weaker helper.
 */
export async function requireAccess(
  resource: Resource,
  access: Access = "read",
): Promise<ActiveUser> {
  const user = await readActiveUser();
  if (!user) redirect("/login");
  if (!can(user.role, resource, access)) redirect("/forbidden");
  return user;
}

/** Authentication and freshness only, for pages with no single resource. */
export async function requireActiveUser(): Promise<ActiveUser> {
  const user = await readActiveUser();
  if (!user) redirect("/login");
  return user;
}
