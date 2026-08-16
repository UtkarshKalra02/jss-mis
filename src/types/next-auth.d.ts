import type { DefaultSession } from "next-auth";

import type { Role } from "@/auth/roles";

/**
 * Teaches Auth.js about the fields this app puts on the session and token.
 * Without this, session.user.role is `any` and the role matrix loses its
 * type safety at exactly the point it matters.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    role: Role;
  }
}

/**
 * Augments "@auth/core/jwt", NOT "next-auth/jwt".
 *
 * next-auth/jwt.d.ts is `export * from "@auth/core/jwt"` — a pure re-export.
 * Declaring `interface JWT` against that path creates a NEW interface in the
 * next-auth/jwt namespace instead of merging with the real one, so the fields
 * silently stay `unknown` at every call site. The augmentation has to name the
 * module where the interface is actually declared.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    username: string;
    role: Role;
  }
}
