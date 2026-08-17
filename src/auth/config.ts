import type { NextAuthConfig } from "next-auth";

import { LANDING_ROUTE, type Role } from "./roles";

/**
 * EDGE-SAFE auth config.
 *
 * Next.js middleware runs on the edge runtime, which has no Node APIs — it
 * cannot open a database connection or run bcrypt. So the config is split:
 *
 *   config.ts (this file) — callbacks that only touch the JWT. Imported by
 *                           middleware. No database, no bcrypt, no imports
 *                           that transitively reach either.
 *   index.ts              — the same config plus the Credentials provider,
 *                           which does hit the database. Imported by server
 *                           code only.
 *
 * This split is a requirement of the runtime, not a preference. If you ever
 * see "PrismaClient/pg is not supported in Edge Runtime" or similar, something
 * has imported the wrong half — check what middleware pulls in.
 *
 * Consequence worth knowing: because middleware only reads the JWT, it can
 * confirm that SOMEBODY is logged in but not what they are currently allowed
 * to do — the token's role and account status are a snapshot from sign-in and
 * do not change for its whole lifetime. Middleware is a redirect, not a
 * security boundary. Real authorization is requireAccess() in
 * src/auth/guard.ts, which re-reads the account from the database on every
 * guarded page so deactivation and role changes take effect at once.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },

  session: {
    strategy: "jwt",
    // Credentials sessions are JWT-only; Auth.js does not support database
    // sessions with this provider. A role change therefore does not take
    // effect until the token refreshes, so the window is kept short.
    maxAge: 60 * 60 * 8, // one working day
    updateAge: 60 * 15,
  },

  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the sign-in pass.
      if (user) {
        token.id = user.id as string;
        token.username = user.username;
        token.role = user.role;
      }
      return token;
    },

    session({ session, token }) {
      session.user.id = token.id;
      session.user.username = token.username;
      session.user.role = token.role;
      return session;
    },

    /**
     * Runs in middleware. Signed-in users are let through; everyone else is
     * redirected to /login. Fine-grained per-resource checks deliberately do
     * NOT live here — see the note above.
     */
    authorized({ auth, request }) {
      const signedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      if (pathname === "/login") {
        if (signedIn) {
          const role = auth!.user.role as Role;
          return Response.redirect(new URL(LANDING_ROUTE[role] ?? "/dashboard", request.url));
        }
        return true;
      }

      return signedIn;
    },
  },

  providers: [], // filled in by src/auth/index.ts
} satisfies NextAuthConfig;
