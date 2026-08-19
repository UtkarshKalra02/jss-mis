/**
 * The importer's validation pass — a pure function over strings.
 *
 * Everything the preview screen shows comes from here: which rows are fine,
 * which are warnings, which are refused and exactly why. It takes strings and
 * lookups and returns a verdict, with no database, no file parsing and no
 * session involved, so the rules can be tested directly. Those rules are the
 * whole safety of the feature — the requirement is that a person sees precisely
 * what will happen before anything is written.
 *
 * Two rules here are non-obvious and both come from the requirements:
 *
 *   - An unmatched client is REFUSED, never created. Auto-creating clients from
 *     a spreadsheet is how "Nature Packaging", "Nature packaging Pvt Ltd" and
 *     "NAure Packaging" become three customers nobody notices until a report is
 *     split three ways.
 *   - An error stops its own row and nothing else. A file of forty jobs with
 *     two bad dates imports thirty-eight.
 */

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

export type ValidatedRow = {
  rowNumber: number;
  status: "ok" | "warning" | "error";
  /** One sentence per problem, in the order they were found. */
  reasons: string[];
  raw: RawRow;
  /** Present only when status is not "error". */
  parsed?: {
    clientId: string;
    clientName: string;
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

export type ValidationSummary = {
  total: number;
  ok: number;
  warning: number;
  error: number;
  /** Rows that will be skipped: duplicates of something already imported. */
  duplicate: number;
  /** Client names in the file that do not exist yet, deduplicated. */
  unknownClients: string[];
};

export type ValidationResult = {
  rows: ValidatedRow[];
  summary: ValidationSummary;
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
 */
export function dedupeKey(clientId: string, poNo: string, itemName: string): string {
  return `${clientId}|${normalise(poNo)}|${normalise(itemName)}`;
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

/**
 * Validates every row against the lookups it needs.
 *
 * @param existingKeys dedupeKey() values already in the database. A match is a
 *   WARNING and the row is skipped — never overwritten. Re-running the same
 *   file must be safe, because somebody will.
 */
export function validateRows(
  rows: readonly RawRow[],
  lookups: { clients: readonly ClientLookup[]; existingKeys: ReadonlySet<string> },
): ValidationResult {
  // Matched on name OR code, because people type whichever is on the paper.
  const byName = new Map<string, ClientLookup>();
  for (const c of lookups.clients) {
    byName.set(normalise(c.name), c);
    byName.set(normalise(c.code), c);
  }

  const unknownClients = new Set<string>();
  // Duplicates WITHIN the file, as well as against the database.
  const seenInFile = new Set<string>();

  const validated = rows.map((raw): ValidatedRow => {
    const reasons: string[] = [];
    const errors: string[] = [];

    const client = byName.get(normalise(raw.clientName));
    if (raw.clientName.trim().length === 0) {
      errors.push("Client is blank.");
    } else if (!client) {
      unknownClients.add(raw.clientName.trim());
      errors.push(
        `No client matches "${raw.clientName.trim()}". Add them on the Clients screen first — the importer never creates clients.`,
      );
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

    // Safe: every one of these was checked above.
    const key = dedupeKey(client!.id, raw.poNo, raw.itemName);

    if (lookups.existingKeys.has(key)) {
      reasons.unshift("Already imported — this row will be skipped, not overwritten.");
    } else if (seenInFile.has(key)) {
      reasons.unshift("The same client, PO number and item appear earlier in this file.");
    }
    seenInFile.add(key);

    const challan = raw.challanNo.trim();

    return {
      rowNumber: raw.rowNumber,
      status: reasons.length > 0 ? "warning" : "ok",
      reasons,
      raw,
      parsed: {
        clientId: client!.id,
        clientName: client!.name,
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
        poKey: `${client!.id}|${normalise(raw.poNo)}`,
        challanKey:
          dispatchedQty > 0
            ? challan.length > 0
              ? `${client!.id}|${normalise(challan)}`
              : // No challan number given: this row gets its own, allocated on
                // write. Keyed by row so it cannot merge with anything else.
                `${client!.id}|row-${raw.rowNumber}`
            : null,
      },
    };
  });

  const alreadyImported = validated.filter((r) =>
    r.reasons.some((reason) => reason.startsWith("Already imported")),
  ).length;

  return {
    rows: validated,
    summary: {
      total: validated.length,
      ok: validated.filter((r) => r.status === "ok").length,
      warning: validated.filter((r) => r.status === "warning").length,
      error: validated.filter((r) => r.status === "error").length,
      duplicate: alreadyImported,
      unknownClients: [...unknownClients].sort(),
    },
  };
}

/** The rows that will actually be written: valid, and not already imported. */
export function importableRows(result: ValidationResult): ValidatedRow[] {
  return result.rows.filter(
    (r) =>
      r.status !== "error" &&
      !r.reasons.some((reason) => reason.startsWith("Already imported")),
  );
}
