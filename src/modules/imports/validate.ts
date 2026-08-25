/**
 * The importer's validation pass — a pure function over strings.
 *
 * Everything the preview screen shows comes from here: which rows are fine,
 * which are warnings, which need a decision, which are refused and exactly why.
 * It takes strings and lookups and returns a verdict, with no database, no file
 * parsing and no session involved, so the rules can be tested directly. Those
 * rules are the whole safety of the feature — the requirement is that a person
 * sees precisely what will happen before anything is written.
 *
 * Three rules here are non-obvious and all come from the requirements:
 *
 *   - Client matching is tolerant, creation is not automatic in the doubtful
 *     case. An exact match after normalising is used silently; a name nothing
 *     resembles is created; a name that is SIMILAR to an existing client is
 *     neither, and goes to review for a human to decide. The matching itself
 *     lives in match.ts. See decision F32.
 *   - An error stops its own row and nothing else. A file of forty jobs with
 *     two bad dates imports thirty-eight.
 *   - Dates are read day-first, and a committed date may be blank (F8).
 */

import {
  buildClientIndex,
  matchClient,
  normaliseClientName,
  type ClientCandidate,
} from "./match";

export type RawRow = {
  /** 1-based, as the person sees it in the spreadsheet. */
  rowNumber: number;
  clientName: string;
  poNo: string;
  poDate: string;
  itemName: string;
  orderedQty: string;
  rate: string;
  committedDate: string;
  dispatchDate: string;
  dispatchedQty: string;
  challanNo: string;
};

export type ClientLookup = { id: string; code: string; name: string };

/**
 * The answer to one review row, chosen by a person on the preview screen.
 *
 * Keyed by the NORMALISED client name rather than by row number, which is what
 * makes requirement 5 hold: two rows that normalise to the same name cannot
 * resolve to two different clients, because there is only one place to record
 * the answer. The screen still shows the control on every affected row — the
 * choice is made per row and applies to the name.
 *
 * The value is a client id, or CREATE_NEW.
 */
export type ClientDecisions = Readonly<Record<string, string>>;

export const CREATE_NEW = "new";

export type ValidatedRow = {
  rowNumber: number;
  status: "ok" | "warning" | "review" | "error";
  /** One sentence per problem, in the order they were found. */
  reasons: string[];
  raw: RawRow;
  /**
   * Present only on a row whose client needs a decision. Carries what the
   * screen has to show: the name as typed and what it might be instead.
   */
  review?: { key: string; typed: string; candidates: ClientCandidate[] };
  /** Present only when the row will be written. */
  parsed?: {
    /**
     * Identifies the client for grouping and deduping. The client's id when it
     * already exists, and "new:<normalised name>" when it is about to be
     * created — a created client has no id until the write runs, and rows that
     * share a name have to group together before then.
     */
    clientToken: string;
    /** Null when the client will be created by this import. */
    clientId: string | null;
    /**
     * The name to store, as typed in the sheet. Casing is preserved
     * deliberately: normalising is for comparing, never for storing.
     */
    clientName: string;
    /** Set only when this row's client is being created. */
    newClientKey: string | null;
    poNo: string;
    poDate: string;
    itemName: string;
    orderedQty: number;
    rate: string | null;
    /** Null is legitimate and flagged — F8. */
    committedDate: string | null;
    dispatchDate: string | null;
    dispatchedQty: number;
    challanNo: string | null;
    /** Rows sharing this become ONE purchase_order. */
    poKey: string;
    /** Rows sharing this become ONE dispatch. Null when nothing went out. */
    challanKey: string | null;
  };
};

/** One client name in the file that needs a person to decide what it is. */
export type ClientReview = {
  /** The normalised name. The decision is recorded against this. */
  key: string;
  /** As typed in the sheet, from the first row that used it. */
  typed: string;
  candidates: ClientCandidate[];
  /** Every row in the file waiting on this one answer. */
  rowNumbers: number[];
};

/** One client name in the file that will be created on confirm. */
export type ClientCreation = { key: string; name: string; rowNumbers: number[] };

export type ValidationSummary = {
  total: number;
  ok: number;
  warning: number;
  review: number;
  error: number;
  /** Rows that will be skipped: duplicates of something already imported. */
  duplicate: number;
  /**
   * Distinct client names in the file, by what will happen to them. Counted by
   * NAME rather than by row, because "3 will be created" is a statement about
   * customers appearing in the client master, not about spreadsheet rows.
   */
  clients: { matched: number; toCreate: number; needsReview: number };
};

export type ValidationResult = {
  rows: ValidatedRow[];
  summary: ValidationSummary;
  /** The unanswered questions, for the panel above the grid. */
  reviews: ClientReview[];
  /** What confirming will add to the client master. */
  creations: ClientCreation[];
};

/** Trimmed, collapsed whitespace, lowercased. Used for matching names only. */
export function normalise(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The dedupe key from the requirements: client + PO no + item name.
 *
 * Also the key that groups rows into one purchase order, minus the item — two
 * rows with the same client and PO number are two items on ONE order, not two
 * orders that happen to share a number.
 *
 * The first argument is a client TOKEN, not necessarily an id: for a client
 * this import is about to create it is "new:<normalised name>". A token of that
 * shape can never collide with a key built from the database, which is keyed by
 * uuid — so a client that does not exist yet cannot be deduped against one that
 * does.
 */
export function dedupeKey(clientToken: string, poNo: string, itemName: string): string {
  return `${clientToken}|${normalise(poNo)}|${normalise(itemName)}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DDMMYYYY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/**
 * DD/MM/YYYY to YYYY-MM-DD.
 *
 * Day first, because that is what the requirement says and what everyone in
 * the building writes. The distinction is not cosmetic: 03/04/2026 is a
 * different day under each convention, and both parse silently. Guessing here
 * would put a job's dates three weeks out with nothing to show for it.
 *
 * An ISO string is also accepted, because that is what a spreadsheet cell
 * formatted as a real date normalises to before it reaches this function.
 */
export function parseDate(value: string): { ok: true; iso: string } | { ok: false } {
  const text = value.trim();
  if (text.length === 0) return { ok: false };

  if (ISO.test(text)) {
    return isRealDate(text) ? { ok: true, iso: text } : { ok: false };
  }

  const match = DDMMYYYY.exec(text);
  if (!match) return { ok: false };

  const [, d, m, y] = match;
  const iso = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  return isRealDate(iso) ? { ok: true, iso } : { ok: false };
}

/** Rejects 31/02/2026, which passes the shape check and is not a day. */
function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d
  );
}

function parseQty(value: string): number | null {
  const text = value.trim().replace(/,/g, "");
  if (text.length === 0) return null;
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function parseMoney(value: string): string | null | undefined {
  const text = value.trim().replace(/[,₹\s]/g, "");
  if (text.length === 0) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined; // undefined = invalid
  return text;
}

/** How one row's client came out, once decisions have been applied. */
type ResolvedClient =
  | { kind: "existing"; id: string; name: string; key: string }
  | { kind: "create"; key: string; name: string }
  | { kind: "review"; key: string; typed: string; candidates: ClientCandidate[] }
  | { kind: "refused"; reason: string };

/**
 * Validates every row against the lookups it needs.
 *
 * @param existingKeys dedupeKey() values already in the database. A match is a
 *   WARNING and the row is skipped — never overwritten. Re-running the same
 *   file must be safe, because somebody will.
 * @param decisions answers to review rows, keyed by normalised client name.
 *   Absent on the first pass; supplied once a person has chosen.
 */
export function validateRows(
  rows: readonly RawRow[],
  lookups: {
    clients: readonly ClientLookup[];
    existingKeys: ReadonlySet<string>;
    decisions?: ClientDecisions;
  },
): ValidationResult {
  const index = buildClientIndex(lookups.clients);
  const byId = new Map(lookups.clients.map((c) => [c.id, c]));
  const decisions = lookups.decisions ?? {};

  function resolveClient(typedName: string): ResolvedClient {
    const typed = typedName.trim();
    const key = normaliseClientName(typed);
    const match = matchClient(typed, index);

    if (match.kind === "matched") {
      return { kind: "existing", id: match.client.id, name: match.client.name, key };
    }

    if (match.kind === "ambiguous") {
      // Two live clients whose names differ only by a legal suffix. Guessing
      // between them attaches real orders to the wrong customer, silently.
      return {
        kind: "refused",
        reason:
          `"${typed}" matches ${match.candidates.length} clients equally well ` +
          `(${match.candidates.map((c) => `${c.name} [${c.code}]`).join(", ")}). ` +
          "Put the client CODE in this column instead of the name.",
      };
    }

    if (match.kind === "create") return { kind: "create", key, name: typed };

    // Similar to something. Only a person can say which.
    const decision = decisions[key];
    if (decision === CREATE_NEW) return { kind: "create", key, name: typed };

    if (decision) {
      const chosen = byId.get(decision);
      // A decision naming a client that is no longer there falls back to
      // review rather than being ignored — the database may have changed
      // between the preview and the confirm (F30).
      if (chosen) return { kind: "existing", id: chosen.id, name: chosen.name, key };
    }

    return { kind: "review", key, typed, candidates: match.candidates };
  }

  // Duplicates WITHIN the file, as well as against the database.
  const seenInFile = new Set<string>();

  const validated = rows.map((raw): ValidatedRow => {
    const reasons: string[] = [];
    const errors: string[] = [];

    let client: ResolvedClient | null = null;

    if (raw.clientName.trim().length === 0) {
      errors.push("Client is blank.");
    } else {
      client = resolveClient(raw.clientName);
      if (client.kind === "refused") errors.push(client.reason);
    }

    if (raw.itemName.trim().length === 0) errors.push("Item name is blank.");

    // Part of the dedupe key, so a blank one makes re-running the file unsafe:
    // two blank-numbered rows for the same client and item are indistinguishable.
    if (raw.poNo.trim().length === 0) {
      errors.push("PO number is blank. It is part of the key that stops a re-run duplicating.");
    }

    // Held as a plain value rather than read off the discriminated union
    // later: the union is only narrowed inside the `if`, and the compiler has
    // no way to know that a failed parse always pushed an error.
    let poDateIso: string | null = null;
    const poDate = parseDate(raw.poDate);
    if (poDate.ok) {
      poDateIso = poDate.iso;
    } else {
      errors.push(`PO date "${raw.poDate.trim()}" is not a date. Use DD/MM/YYYY.`);
    }

    const orderedQty = parseQty(raw.orderedQty);
    if (orderedQty === null) {
      errors.push(`Ordered quantity "${raw.orderedQty.trim()}" is not a whole number.`);
    } else if (orderedQty <= 0) {
      errors.push("Ordered quantity must be more than zero.");
    }

    const rate = parseMoney(raw.rate);
    if (rate === undefined) errors.push(`Rate "${raw.rate.trim()}" is not an amount.`);

    // F8: blank is allowed, and flagged. These jobs count toward lead time and
    // are excluded from OTD entirely.
    let committedDate: string | null = null;
    if (raw.committedDate.trim().length > 0) {
      const parsedCommitted = parseDate(raw.committedDate);
      if (!parsedCommitted.ok) {
        errors.push(
          `Committed date "${raw.committedDate.trim()}" is not a date. Use DD/MM/YYYY, or leave it blank.`,
        );
      } else {
        committedDate = parsedCommitted.iso;
      }
    } else {
      reasons.push("No committed date — imported as historical, and excluded from OTD.");
    }

    const dispatchedQty = parseQty(raw.dispatchedQty) ?? 0;
    if (raw.dispatchedQty.trim().length > 0 && parseQty(raw.dispatchedQty) === null) {
      errors.push(`Dispatched quantity "${raw.dispatchedQty.trim()}" is not a whole number.`);
    }

    let dispatchDate: string | null = null;
    if (dispatchedQty > 0) {
      const parsedDispatch = parseDate(raw.dispatchDate);
      if (!parsedDispatch.ok) {
        errors.push(
          `Dispatched quantity is ${dispatchedQty} but the dispatch date "${raw.dispatchDate.trim()}" is not a date.`,
        );
      } else {
        dispatchDate = parsedDispatch.iso;
      }

      if (orderedQty !== null && dispatchedQty > orderedQty) {
        errors.push(
          `Dispatched ${dispatchedQty} is more than the ${orderedQty} ordered.`,
        );
      }
    }

    if (dispatchDate && poDateIso && dispatchDate < poDateIso) {
      reasons.push("Dispatched before the PO date. Check the dates.");
    }

    if (errors.length > 0) {
      return { rowNumber: raw.rowNumber, status: "error", reasons: errors, raw };
    }

    // Everything else about the row is fine; it is waiting on one answer.
    if (client!.kind === "review") {
      return {
        rowNumber: raw.rowNumber,
        status: "review",
        reasons: [
          `"${client!.typed}" is close to ${client!.candidates
            .map((c) => `"${c.name}"`)
            .join(" and ")}, but not the same. Choose which it is.`,
          ...reasons,
        ],
        raw,
        review: {
          key: client!.key,
          typed: client!.typed,
          candidates: client!.candidates,
        },
      };
    }

    const resolved = client as
      | { kind: "existing"; id: string; name: string; key: string }
      | { kind: "create"; key: string; name: string };

    const clientToken = resolved.kind === "existing" ? resolved.id : `new:${resolved.key}`;
    const key = dedupeKey(clientToken, raw.poNo, raw.itemName);

    const alreadyImported = lookups.existingKeys.has(key);

    if (alreadyImported) {
      reasons.unshift("Already imported — this row will be skipped, not overwritten.");
    } else if (seenInFile.has(key)) {
      reasons.unshift("The same client, PO number and item appear earlier in this file.");
    }
    seenInFile.add(key);

    // Said AFTER the duplicate check, because a row that is going to be
    // skipped creates nothing. Announcing both on the same row reads as a
    // contradiction and would be one.
    if (resolved.kind === "create" && !alreadyImported) {
      reasons.push(
        `"${resolved.name}" is not on the client list and will be created, ready for you to check.`,
      );
    }

    const challan = raw.challanNo.trim();

    return {
      rowNumber: raw.rowNumber,
      status: reasons.length > 0 ? "warning" : "ok",
      reasons,
      raw,
      parsed: {
        clientToken,
        clientId: resolved.kind === "existing" ? resolved.id : null,
        clientName: resolved.name,
        newClientKey: resolved.kind === "create" ? resolved.key : null,
        poNo: raw.poNo.trim(),
        poDate: poDateIso!,
        itemName: raw.itemName.trim(),
        orderedQty: orderedQty!,
        rate: rate ?? null,
        committedDate,
        dispatchDate,
        dispatchedQty,
        challanNo: challan.length > 0 ? challan : null,
        // Two rows with the same client and PO number are two ITEMS on one
        // order, not two orders that happen to share a number.
        poKey: `${clientToken}|${normalise(raw.poNo)}`,
        challanKey:
          dispatchedQty > 0
            ? challan.length > 0
              ? `${clientToken}|${normalise(challan)}`
              : // No challan number given: this row gets its own, allocated on
                // write. Keyed by row so it cannot merge with anything else.
                `${clientToken}|row-${raw.rowNumber}`
            : null,
      },
    };
  });

  const duplicates = validated.filter((r) =>
    r.reasons.some((reason) => reason.startsWith("Already imported")),
  ).length;

  // Aggregated from the FINISHED rows rather than as they are validated.
  // A row refused for a bad date is not a question about its client, and a
  // client whose only row is a skipped duplicate is not about to be created —
  // counting during the pass would announce both.
  //
  // All three are keyed by the normalised name, which is what makes
  // requirement 5 hold: two spellings of one customer are one entry here, one
  // decision on the screen, and one row in the client master.
  const reviews = new Map<string, ClientReview>();
  const creations = new Map<string, ClientCreation>();
  const matched = new Set<string>();

  for (const row of validated) {
    if (row.review) {
      const entry = reviews.get(row.review.key);
      if (entry) entry.rowNumbers.push(row.rowNumber);
      else reviews.set(row.review.key, { ...row.review, rowNumbers: [row.rowNumber] });
    }
  }

  for (const row of validated.filter(isImportable)) {
    const { newClientKey, clientName, clientId } = row.parsed!;

    if (newClientKey === null) {
      if (clientId) matched.add(clientId);
      continue;
    }

    const entry = creations.get(newClientKey);
    if (entry) entry.rowNumbers.push(row.rowNumber);
    else
      // First spelling in the file wins. Arbitrary, but stable, and it is
      // somebody's actual typing rather than something this code invented.
      creations.set(newClientKey, {
        key: newClientKey,
        name: clientName,
        rowNumbers: [row.rowNumber],
      });
  }

  return {
    rows: validated,
    reviews: [...reviews.values()],
    creations: [...creations.values()],
    summary: {
      total: validated.length,
      ok: validated.filter((r) => r.status === "ok").length,
      warning: validated.filter((r) => r.status === "warning").length,
      review: validated.filter((r) => r.status === "review").length,
      error: validated.filter((r) => r.status === "error").length,
      duplicate: duplicates,
      clients: {
        matched: matched.size,
        toCreate: creations.size,
        needsReview: reviews.size,
      },
    },
  };
}

/**
 * Whether one row will actually be written: valid, decided, and not already
 * imported.
 *
 * A row awaiting a decision is excluded as firmly as a refused one. That is the
 * safety property of F32 — nothing whose client is in doubt reaches the
 * database, whether or not anybody looked at the screen.
 */
function isImportable(row: ValidatedRow): boolean {
  return (
    row.status !== "error" &&
    row.status !== "review" &&
    !row.reasons.some((reason) => reason.startsWith("Already imported"))
  );
}

/** The rows that will actually be written. */
export function importableRows(result: ValidationResult): ValidatedRow[] {
  return result.rows.filter(isImportable);
}

/** The clients a confirm will create, in the order they appear in the file. */
export function clientsToCreate(result: ValidationResult): ClientCreation[] {
  const needed = new Set(
    importableRows(result)
      .map((r) => r.parsed!.newClientKey)
      .filter((k): k is string => k !== null),
  );

  // A client whose only rows are duplicates of something already imported is
  // NOT created. Skipping the row and creating its customer anyway would leave
  // an empty client behind every re-run of the same file.
  return result.creations.filter((c) => needed.has(c.key));
}
