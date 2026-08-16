/**
 * Sets one user's password.
 *
 *   npm run set-password -- <username>
 *
 * The password is PROMPTED FOR, never passed as an argument. An argument would
 * land in shell history and be visible in `ps` to anyone else on the machine.
 * Input is not echoed, and is typed twice to catch a mistype — there is no
 * "forgot password" flow to recover from one.
 *
 * Writes an audit_log row attributed to SYSTEM. The row records THAT the
 * password changed, never the hash: an audit log holding password hashes is a
 * second copy of the credential table with weaker access control.
 */
import * as readline from "node:readline";
import { Writable } from "node:stream";

import { config } from "dotenv";

config({ path: ".env.local" });

// See the note in seed-users.ts: a static import of src/db would be hoisted
// above config() and env validation would fail on an empty environment.
type DbModule = typeof import("../src/db");
type SchemaModule = typeof import("../src/db/schema");

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
const MIN_LENGTH = 8;
const BCRYPT_ROUNDS = 12;

/**
 * readline's output goes NOWHERE. Everything it would echo — including the
 * characters being typed — is discarded, and this script writes its own
 * prompts straight to stdout instead.
 *
 * The obvious alternative is a mute flag toggled around each question. That
 * has a race: readline drains whatever is already buffered on stdin in one go,
 * so between the first answer and the second prompt there is a window where
 * the flag is off and the next line gets echoed in clear text. Discarding
 * unconditionally has no such window.
 */
const discardOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

/**
 * ONE readline interface is created and reused for both prompts.
 *
 * Opening a fresh interface per prompt looks tidier but breaks: the first
 * interface consumes stdin and closing it ends the stream, so the second
 * prompt reads nothing and the script hangs. That failure is invisible on a
 * TTY where a human is waiting anyway, which is exactly why it is worth
 * getting right.
 */
let rl: readline.Interface | null = null;

/** Lines already read but not yet asked for. */
const buffered: string[] = [];
/** Prompts waiting for a line that has not arrived yet. */
const waiting: ((line: string) => void)[] = [];
let inputEnded = false;

function ensureInterface() {
  if (rl) return rl;

  rl = readline.createInterface({
    input: process.stdin,
    output: discardOutput,
    // terminal:true is what makes readline echo keystrokes, so it is only
    // wanted on a real TTY — which is exactly where discardOutput suppresses
    // the echo. On a pipe there is nothing to suppress.
    terminal: Boolean(process.stdin.isTTY),
  });

  // Lines are queued rather than read with rl.question().
  //
  // question() only captures the NEXT 'line' event. When stdin is a pipe,
  // readline emits a 'line' for every buffered line in one burst, so the
  // second password is emitted while nothing is listening and is silently
  // dropped — the script then waits forever for input that already came and
  // went. Queueing decouples "a line arrived" from "somebody asked for one".
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else buffered.push(line);
  });

  rl.on("close", () => {
    inputEnded = true;
  });

  return rl;
}

function promptHidden(question: string): Promise<string> {
  ensureInterface();
  process.stdout.write(question);

  const queued = buffered.shift();
  if (queued !== undefined) {
    process.stdout.write("\n");
    return Promise.resolve(queued);
  }

  if (inputEnded) {
    return Promise.reject(new Error("Input ended before the prompt was answered."));
  }

  return new Promise((resolve) => {
    waiting.push((line) => {
      process.stdout.write("\n");
      resolve(line);
    });
  });
}

function closePrompt() {
  rl?.close();
  rl = null;
}

async function main() {
  const username = process.argv[2]?.trim();

  if (!username) {
    console.error("Usage: npm run set-password -- <username>");
    process.exit(1);
  }

  const { hash } = await import("bcryptjs");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { db }: DbModule = await import("../src/db");
  const { appUser, auditLog }: SchemaModule = await import("../src/db/schema");

  const [user] = await db
    .select({
      id: appUser.id,
      username: appUser.username,
      name: appUser.name,
      role: appUser.role,
      isActive: appUser.isActive,
      hasPassword: appUser.passwordHash,
    })
    .from(appUser)
    .where(and(eq(appUser.username, username), isNull(appUser.deletedAt)))
    .limit(1);

  if (!user) {
    console.error(`No active user with username "${username}".`);
    console.error("Run `npm run seed:users` first, or check the spelling.");
    process.exit(1);
  }

  if (user.id === SYSTEM_USER_ID) {
    console.error("The SYSTEM account cannot be given a password.");
    process.exit(1);
  }

  console.log(`\nSetting password for ${user.name} (${user.username}, ${user.role})`);
  if (!user.isActive) console.log("Note: this account is currently INACTIVE and cannot sign in.");
  if (user.hasPassword) console.log("Note: this will REPLACE the existing password.");
  console.log();

  const first = await promptHidden("New password: ");
  if (first.length < MIN_LENGTH) {
    closePrompt();
    console.error(`Password must be at least ${MIN_LENGTH} characters. Nothing was changed.`);
    process.exit(1);
  }

  const second = await promptHidden("Confirm password: ");
  closePrompt();

  if (first !== second) {
    console.error("Passwords did not match. Nothing was changed.");
    process.exit(1);
  }

  const passwordHash = await hash(first, BCRYPT_ROUNDS);

  await db.transaction(async (tx) => {
    await tx.update(appUser).set({ passwordHash, updatedBy: SYSTEM_USER_ID }).where(eq(appUser.id, user.id));

    await tx.insert(auditLog).values({
      tableName: "app_user",
      recordId: user.id,
      action: "UPDATE",
      changedBy: SYSTEM_USER_ID,
      // Redacted on purpose. The audit trail records that the credential
      // changed, never its value.
      before: { passwordHash: user.hasPassword ? "[redacted]" : null },
      after: { passwordHash: "[redacted]" },
    });
  });

  console.log(`\nPassword set for ${user.username}. They can sign in now.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
