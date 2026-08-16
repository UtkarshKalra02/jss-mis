import { redirect } from "next/navigation";

import { currentUser } from "./index";
import { can, type Access, type Resource } from "./roles";

/**
 * The guard every protected page and server action should start with.
 *
 * requireUser() alone is NOT enough — it proves somebody is signed in, not
 * that they are allowed to be on this screen. A page that only calls
 * requireUser() is reachable by any authenticated user who types the URL,
 * regardless of what the role matrix says. That is precisely how a screen ends
 * up hidden from the sidebar but still open to everyone, which was found by
 * testing FLOOR against /dashboard.
 *
 * Returns the user so the caller gets authentication and authorization in one
 * line, leaving no reason to reach for the weaker helper.
 */
export async function requireAccess(resource: Resource, access: Access = "read") {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, resource, access)) redirect("/forbidden");
  return user;
}
