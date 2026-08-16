import { compare } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { db } from "@/db";
import { appUser } from "@/db/schema";

import { authConfig } from "./config";

/**
 * Full auth config. Server-only — importing this from middleware would drag
 * the database driver and bcrypt into the edge runtime. Middleware imports
 * ./config instead.
 */

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { username, password } = parsed.data;

        const [user] = await db
          .select()
          .from(appUser)
          .where(and(eq(appUser.username, username), isNull(appUser.deletedAt)))
          .limit(1);

        // Every failure below returns the same null, and the login form shows
        // one message for all of them. Distinguishing "no such user" from
        // "wrong password" tells an attacker which usernames exist.
        if (!user) return null;
        if (!user.isActive) return null;

        // Null hash means "no usable password" — a seeded account nobody has
        // run set-password for yet, or the SYSTEM user. It can never
        // authenticate. Checked explicitly rather than relying on compare()
        // rejecting a null.
        if (!user.passwordHash) return null;

        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;

        // Deliberately NOT routed through the audit wrapper (decision E5).
        // last_login_at is session bookkeeping, not a business record change,
        // and auditing every login would bury real changes under noise.
        await db
          .update(appUser)
          .set({ lastLoginAt: new Date() })
          .where(eq(appUser.id, user.id));

        return {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email ?? undefined,
          role: user.role,
        };
      },
    }),
  ],
});

/**
 * The signed-in user, or null. Use in server components and actions.
 * Prefer requireUser() when the caller cannot proceed without one.
 */
export async function currentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/** Throws when nobody is signed in. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}
