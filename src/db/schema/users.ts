import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { userRoleEnum } from "./enums";

/**
 * app_user.
 *
 * Defined in its own file, and spelling out its own audit columns rather than
 * using the shared helper, because created_by/updated_by point back at
 * app_user itself. Keeping it here means the dependency graph stays acyclic:
 *
 *   enums.ts -> users.ts -> _shared.ts -> every other table
 *
 * The self-reference needs an explicit AnyPgColumn annotation; without it
 * TypeScript cannot infer the type of a table that refers to itself.
 */
export const appUser = pgTable(
  "app_user",
  {
    id: uuid().primaryKey().defaultRandom(),

    username: text().notNull(),
    name: text().notNull(),
    email: text(),
    role: userRoleEnum().notNull(),

    /**
     * Null means "no usable password" — the account exists but cannot
     * authenticate. Users are seeded in this state and given a password
     * one at a time via `npm run set-password`. Passwords are never written
     * into a config or seed file.
     */
    passwordHash: text(),

    /**
     * True when the current password was set by an ADMIN for somebody else.
     * The app forces that person to choose their own before they can reach any
     * screen, so a working password is known only to the person using it —
     * handing someone a temporary one is unavoidable, leaving it in place is
     * not. Cleared when they set their own.
     */
    mustChangePassword: boolean().notNull().default(false),

    isActive: boolean().notNull().default(true),
    lastLoginAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references((): AnyPgColumn => appUser.id),
    updatedBy: uuid().references((): AnyPgColumn => appUser.id),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Partial unique: a soft-deleted user must not permanently burn a
    // username. Without the WHERE clause, deactivating "punit" would mean
    // nobody could ever be "punit" again.
    uniqueIndex("app_user_username_key")
      .on(t.username)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export type AppUser = typeof appUser.$inferSelect;
export type NewAppUser = typeof appUser.$inferInsert;
