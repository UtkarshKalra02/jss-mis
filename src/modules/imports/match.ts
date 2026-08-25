/**
 * CLIENT NAME MATCHING for the importer (decision F32).
 *
 * The importer used to refuse every name it did not recognise. That was safe
 * and unusable: a paper book says "NATUREEXPERT AYURVEDIC PVT LTD" and the
 * client list says "Natureexpert Ayurvedic", and forty rows were refused for a
 * difference nobody would call a difference.
 *
 * So matching is now tolerant and creation is allowed — but only in the two
 * cases where the answer is not in doubt:
 *
 *   EXACT after normalising  -> use the existing client, silently.
 *   NOTHING like it at all   -> create it, flagged for review afterwards.
 *   SIMILAR but not equal    -> refuse to decide. The row goes to review and a
 *                               human picks: use the existing one, or create.
 *
 * That third case is the whole point. Auto-creation without it is exactly how
 * "Nature Packaging", "Nature packaging Pvt Ltd" and "NAure Packaging" become
 * three customers nobody notices until a report is split three ways — the
 * failure the old refuse-everything rule was protecting against. The rule is
 * not "create when unsure"; it is "create only when sure, and never decide
 * between two spellings on somebody's behalf".
 *
 * Everything here is a pure function over strings, for the same reason
 * validate.ts is (F29): these rules decide what reaches the client master, and
 * they are worth testing directly rather than through an upload.
 */

import type { ClientLookup } from "./validate";

/* -------------------------------------------------------------------------- */
/* Normalising                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Legal suffixes stripped before comparing.
 *
 * They carry no identity — a company does not become a different customer on
 * the day somebody stops typing "Pvt Ltd" after its name — and they are the
 * single most common reason two spellings of one client fail to match.
 *
 * Longest first, so "private limited" is removed as a unit rather than leaving
 * "private" behind. Stripping repeats until nothing more comes off, which is
 * what takes "pvt ltd" down in two passes.
 */
const LEGAL_SUFFIXES = [
  "private limited",
  "pvt limited",
  "private ltd",
  "limited",
  "private",
  "and co",
  "& co",
  "pvt",
  "ltd",
  "llp",
  "inc",
  "co",
];

/** Punctuation that carries no meaning at the end of a name: "Ltd." , "Co," */
const TRAILING_PUNCTUATION = /[.,\-–—/&'"()\s]+$/;

/**
 * A client name reduced to the part that identifies it.
 *
 * Lowercased, internal whitespace collapsed, trimmed, trailing punctuation
 * removed, and legal suffixes stripped from the end. Comparison happens on the
 * result; the name that gets STORED is always what the person typed.
 *
 * "NATUREEXPERT AYURVEDIC PVT LTD" and "Natureexpert Ayurvedic" both reduce to
 * "natureexpert ayurvedic", which is what makes them the same customer.
 *
 * A name that is nothing BUT a suffix keeps it. Stripping "Ltd" down to an
 * empty string would make every such client match every other one.
 */
export function normaliseClientName(value: string): string {
  let text = value.trim().replace(/\s+/g, " ").toLowerCase();
  text = text.replace(TRAILING_PUNCTUATION, "");

  for (let changed = true; changed; ) {
    changed = false;

    for (const suffix of LEGAL_SUFFIXES) {
      if (!text.endsWith(` ${suffix}`) && text !== suffix) continue;

      const stripped = text
        .slice(0, text.length - suffix.length)
        .replace(TRAILING_PUNCTUATION, "");

      // Only take it off if something identifying is left underneath.
      if (stripped.length > 0) {
        text = stripped;
        changed = true;
      }
    }
  }

  return text;
}

/* -------------------------------------------------------------------------- */
/* Similarity                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The trigram set of a normalised name, built the way Postgres pg_trgm builds
 * it: split on non-alphanumerics, pad each word with two leading spaces and
 * one trailing, then take every three-character window.
 *
 * The padding is what makes word beginnings count for more than word middles,
 * which is what a person comparing two company names does too.
 */
function trigrams(normalised: string): Set<string> {
  const set = new Set<string>();

  for (const word of normalised.split(/[^a-z0-9]+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) set.add(padded.slice(i, i + 3));
  }

  return set;
}

/**
 * How alike two normalised names are, from 0 to 1.
 *
 * |A ∩ B| / |A ∪ B| over trigram sets — the same measure as pg_trgm's
 * similarity(). Trigrams rather than Levenshtein because they do not care
 * about word order and degrade gracefully with length, and because keeping the
 * same definition as Postgres means this can move into SQL later without the
 * numbers changing underneath the threshold.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;

  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const t of left) if (right.has(t)) shared += 1;

  return shared / (left.size + right.size - shared);
}

/**
 * The line between "similar enough that a human must look" and "clearly a
 * different customer".
 *
 * Calibrated against realistic client names. Genuine variants — a typo, a
 * missing letter, a singular for a plural, Shri for Shree — score from about
 * 0.48 upward. Unrelated names score below about 0.12. Nothing in this sample
 * lands between, so 0.45 sits in open space rather than on a cliff, and being
 * slightly wrong in either direction changes no answer.
 *
 * It errs LOW on purpose. The two mistakes are not equal: a name flagged for
 * review that did not need it costs one click, and a name created that should
 * have matched costs a duplicate customer, split reports, and somebody
 * discovering it in a meeting six months later.
 */
export const SIMILARITY_THRESHOLD = 0.45;

/**
 * True when one name's words are wholly contained in the other's.
 *
 * Independent of the threshold, and deliberately so: "Bharat Box" against
 * "Bharat Box Makers" scores 0.59, and "Ganesh Packaging" against "Ganesh
 * Packaging Industries" only 0.61, because trigram similarity is dragged down
 * by the length difference however identical the shared part is. A name that
 * is entirely a subset of another is the most likely duplicate shape there is,
 * so it always goes to review whatever it scores.
 */
function tokensContained(a: string, b: string): boolean {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return false;

  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const token of small) if (!large.has(token)) return false;

  return true;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

export type ClientCandidate = {
  id: string;
  code: string;
  name: string;
  /** 1 for a containment-only candidate is never returned; this is the score. */
  score: number;
};

export type ClientMatch =
  /** Use this client. No question was raised. */
  | { kind: "matched"; client: ClientLookup }
  /** Nothing resembles it. Safe to create. */
  | { kind: "create" }
  /** Close to one or more existing clients. A human chooses. */
  | { kind: "review"; candidates: ClientCandidate[] }
  /** Two existing clients normalise to the same thing. Nobody can guess. */
  | { kind: "ambiguous"; candidates: ClientCandidate[] };

export type ClientIndex = {
  /** Codes match exactly, and are not suffix-stripped — a code is not a name. */
  byCode: Map<string, ClientLookup>;
  byNormalisedName: Map<string, ClientLookup[]>;
  entries: { client: ClientLookup; normalised: string }[];
};

export function buildClientIndex(clients: readonly ClientLookup[]): ClientIndex {
  const byCode = new Map<string, ClientLookup>();
  const byNormalisedName = new Map<string, ClientLookup[]>();
  const entries: { client: ClientLookup; normalised: string }[] = [];

  for (const client of clients) {
    byCode.set(client.code.trim().toLowerCase(), client);

    const normalised = normaliseClientName(client.name);
    const existing = byNormalisedName.get(normalised);
    if (existing) existing.push(client);
    else byNormalisedName.set(normalised, [client]);

    entries.push({ client, normalised });
  }

  return { byCode, byNormalisedName, entries };
}

/** At most this many alternatives are offered on a review row. */
const MAX_CANDIDATES = 3;

/**
 * Resolves one typed client name against the client master.
 *
 * Code is tried first and exactly. Somebody who wrote "NAT" in the spreadsheet
 * meant the client whose code is NAT, and a code is an identifier rather than a
 * name — stripping "Ltd" off it or matching it approximately would be nonsense.
 *
 * A blank name is not this function's problem; the validator refuses it before
 * ever getting here.
 */
export function matchClient(typedName: string, index: ClientIndex): ClientMatch {
  const typed = typedName.trim();

  const byCode = index.byCode.get(typed.toLowerCase());
  if (byCode) return { kind: "matched", client: byCode };

  const normalised = normaliseClientName(typed);

  const exact = index.byNormalisedName.get(normalised);
  if (exact && exact.length === 1) return { kind: "matched", client: exact[0]! };

  if (exact && exact.length > 1) {
    // Two live clients whose names differ only by a legal suffix. Picking one
    // is a coin toss that silently attaches real orders to the wrong customer.
    return {
      kind: "ambiguous",
      candidates: exact.map((c) => ({ id: c.id, code: c.code, name: c.name, score: 1 })),
    };
  }

  const candidates = index.entries
    .map(({ client, normalised: other }) => ({
      id: client.id,
      code: client.code,
      name: client.name,
      score: similarity(normalised, other),
      contained: tokensContained(normalised, other),
    }))
    .filter((c) => c.score >= SIMILARITY_THRESHOLD || c.contained)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(({ id, code, name, score }) => ({ id, code, name, score }));

  if (candidates.length === 0) return { kind: "create" };

  return { kind: "review", candidates };
}

/* -------------------------------------------------------------------------- */
/* Codes for created clients                                                   */
/* -------------------------------------------------------------------------- */

/** Matches clientCodeSchema in modules/clients/validation.ts. */
const CODE_MAX = 12;

/**
 * A code for a client the importer is creating.
 *
 * `client.code` is NOT NULL and unique among live rows, so a created client
 * needs one and the spreadsheet does not carry it. The shape follows the
 * convention already in use — the first three letters of the first word, so
 * "Nature Packaging" is NAT — because a code somebody recognises is worth more
 * than a code that is guaranteed unique on its own.
 *
 * Collisions are resolved with a numeric suffix rather than by being clever.
 * NAT2 is visibly a code that wants attention, and attention is exactly what
 * the "created by import, unreviewed" filter exists to send there.
 *
 * @param taken lowercased codes already in use — live clients, plus the ones
 *   allocated earlier in this same batch, which do not exist in the database
 *   yet and would otherwise all be handed the same code.
 */
export function clientCodeFor(name: string, taken: ReadonlySet<string>): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  let base = "";
  for (const word of words) {
    base += word.slice(0, Math.max(0, 3 - base.length));
    if (base.length >= 3) break;
  }

  // A name with no letters or digits at all — the validator allows any
  // non-blank string, so this is reachable.
  if (base.length < 2) base = "CLI";

  if (!taken.has(base.toLowerCase())) return base;

  for (let n = 2; n < 1000; n += 1) {
    const suffix = String(n);
    const candidate = base.slice(0, CODE_MAX - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  // 998 clients whose names start with the same three letters. Not a real
  // case, but returning a duplicate would hit the unique index and abort the
  // whole import, which is a far worse way to find out.
  throw new Error(`Could not allocate a client code for "${name}".`);
}
