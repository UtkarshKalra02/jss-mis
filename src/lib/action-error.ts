/**
 * What a failed server action says to the person who ran it.
 *
 * Every action used to end `return fail(error instanceof Error ? error.message
 * : "…")`, which is right for the errors the application throws itself — those
 * messages are written for Punit and Preeti and should reach them unchanged —
 * and badly wrong for anything the database throws.
 *
 * A drizzle failure's `message` is the ENTIRE SQL statement followed by every
 * bound parameter. Releasing a job card against a database that was behind the
 * code put two thousand characters of `insert into "job_card" (…) values ($1,
 * $2, …)` on screen, with the item id, the client id and the quantities listed
 * after it. That is unreadable, it is not actionable, and it puts row values in
 * front of whoever happens to be looking at the screen.
 *
 * So: application errors keep their sentence, database errors get one written
 * for them, and the real error always goes to the server log where it is
 * useful.
 */

/** The SQLSTATE codes worth saying something specific about. */
const UNDEFINED_COLUMN = "42703";
const UNDEFINED_TABLE = "42P01";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";

type PgLike = {
  code?: string;
  constraint?: string;
  column?: string;
  table?: string;
  /**
   * Postgres's own message. Quoted ONLY for the schema-drift codes, where it
   * names nothing but schema objects — see sentenceFor.
   */
  message?: string;
};

/**
 * The Postgres error inside whatever the driver wrapped it in.
 *
 * Drizzle throws its own error with the underlying one on `cause`, and the
 * neon driver nests further in some paths, so this walks the chain rather than
 * checking one level.
 */
function postgresErrorIn(error: unknown, depth = 0): PgLike | null {
  if (depth > 5 || error === null || typeof error !== "object") return null;

  const candidate = error as PgLike & { cause?: unknown };

  // A SQLSTATE is five characters. Node's own errors use codes like
  // 'ECONNREFUSED', which must not be mistaken for one.
  if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
    return candidate;
  }

  return postgresErrorIn(candidate.cause, depth + 1);
}

/**
 * Whether this came from the database rather than from our own code.
 *
 * Drizzle's error carries the statement and the parameters it tried to bind;
 * that is the signature worth matching even when no SQLSTATE survived, because
 * it is exactly the error whose message must never be shown.
 */
function isDriverError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  if (postgresErrorIn(error)) return true;

  const candidate = error as { query?: unknown; params?: unknown; message?: unknown };
  if ("query" in candidate && "params" in candidate) return true;

  return typeof candidate.message === "string" && candidate.message.startsWith("Failed query:");
}

/**
 * A sentence for a database failure.
 *
 * The schema-drift case quotes what Postgres said, because that is the one
 * database error where the reader can act on the detail: it names the column
 * that is missing, which is what says WHICH migration has not been run against
 * whichever database this app is pointed at.
 *
 * IT COMES FROM THE MESSAGE, NOT FROM `column` OR `table`. Postgres leaves both
 * of those fields empty for 42703 and 42P01 — they are populated for
 * constraint violations, not for parse-time resolution failures — and reading
 * them produced a sentence with a hole in it where the column name should have
 * been. The message text for these two codes is safe to quote precisely because
 * it contains nothing but identifiers: `column "paper_qty" of relation
 * "job_card" does not exist`.
 *
 * Nothing else quotes anything the database said. `detail` in particular
 * contains the offending ROW VALUES, which is what must not reach the screen.
 */
function sentenceFor(pg: PgLike, fallback: string): string {
  switch (pg.code) {
    case UNDEFINED_COLUMN:
    case UNDEFINED_TABLE: {
      const said = typeof pg.message === "string" ? pg.message.trim() : "";
      const what = said !== "" ? `: ${said}` : " — it is missing something this screen writes";

      return (
        `The database does not match the code${what}. ` +
        `If migrations are pending, run them against it — /api/health lists which are missing.`
      );
    }

    case UNIQUE_VIOLATION:
      return "That already exists. Something with the same key is already in the system.";

    case FOREIGN_KEY_VIOLATION:
      return "Something this refers to is no longer in the system. Reload and try again.";

    case NOT_NULL_VIOLATION:
      return "Something required was left empty.";

    case CHECK_VIOLATION:
      return "The database refused those values as an invalid combination.";

    default:
      return fallback;
  }
}

/**
 * The message an action should return after catching.
 *
 * `fallback` is the sentence that action would have written itself — keep it
 * specific to the action, because it is what a person sees when the database
 * fails in a way nothing here has a better sentence for.
 *
 * Call `unstable_rethrow(error)` BEFORE this, as every action already does, so
 * Next.js control-flow errors (redirect, notFound) are not swallowed.
 */
export function actionError(error: unknown, fallback: string): string {
  if (isDriverError(error)) {
    // The real thing, with its statement and parameters, belongs in the server
    // log — which is where it is actually useful — and nowhere else.
    console.error("[action] database error:", error);

    const pg = postgresErrorIn(error);
    return pg ? sentenceFor(pg, fallback) : fallback;
  }

  // The application's own errors are written for the person reading them.
  return error instanceof Error ? error.message : fallback;
}
