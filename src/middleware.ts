import NextAuth from "next-auth";

import { authConfig } from "@/auth/config";

/**
 * Imports ./auth/config, NOT ./auth — middleware runs on the edge runtime and
 * the full config pulls in bcrypt and the database driver, neither of which
 * exists there.
 *
 * This only checks that somebody is signed in. Per-resource authorization
 * happens in server components and actions against a freshly-read user, so a
 * stale JWT cannot grant access that has since been revoked.
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Everything except Next internals, the auth endpoints, and static files.
    "/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
