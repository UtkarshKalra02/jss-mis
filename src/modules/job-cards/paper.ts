import { paperBundleEnum } from "@/db/schema/enums";

/**
 * How much paper a job card's paper detail band actually describes — decision
 * J18, as a pure function.
 *
 * Extracted from the screen for the reason F25 gives for the stage precedence
 * and H8 for the press-run grouping: this is arithmetic the floor will check
 * against a calculator, and an argument about it is far easier to settle
 * against a test than against a rendered form.
 */

export type PaperBundle = (typeof paperBundleEnum.enumValues)[number];

/**
 * The trade's bundles, in sheets. Fixed numbers, not settings.
 *
 * TYPED AGAINST THE ENUM ON PURPOSE. `Record<PaperBundle, number | null>`
 * means adding a fifth bundle to `paperBundleEnum` without deciding its size
 * here is a compile error rather than a form that silently computes nothing —
 * the same guard the audit wrapper uses to keep its boundaries from being
 * widened quietly (F1). It did its job when `Bundle` was added: the build
 * broke until this table said what to do with it.
 *
 * `Bundle` IS NULL, and null means "the size is written on the row" (V1).
 * J18 took the trade-off of a fixed table and wrote down the cost — mills that
 * ship 480-sheet reams exist, and until that was common it went in Paper
 * remarks. It is common, so the manual bundle exists. The other three are
 * unchanged and still mean exactly what they always did: a Packet is 100
 * sheets, including on the fifty cards already entered.
 */
export const SHEETS_PER_BUNDLE: Record<PaperBundle, number | null> = {
  Packet: 100,
  Ream: 500,
  Gross: 144,
  /** Typed per row — see `sheetsPerBundle` on PaperInput. */
  Bundle: null,
};

/** Whether this bundle's size is typed in rather than looked up. */
export function isManualBundle(bundle: PaperBundle | null | undefined): boolean {
  return bundle === "Bundle";
}

/**
 * Sheets in one bundle: the table for a fixed bundle, the typed figure for a
 * manual one.
 *
 * ONE PLACE RESOLVES THIS, so no screen has to remember which kind it is
 * holding. Returns null when it cannot be known — no bundle chosen, or a
 * manual bundle with nothing typed yet — and null then travels all the way to
 * a blank rather than becoming a guessed multiplier.
 */
export function sheetsInBundle(
  bundle: PaperBundle | null | undefined,
  typed: number | null | undefined,
): number | null {
  if (!bundle) return null;
  if (isManualBundle(bundle)) {
    return typed !== null && typed !== undefined && typed > 0 ? typed : null;
  }
  return SHEETS_PER_BUNDLE[bundle];
}

export type PaperInput = {
  /** How many bundles. */
  qty: number | null | undefined;
  bundle: PaperBundle | null | undefined;
  /**
   * Sheets in one bundle, for the manual bundle only (V1). Ignored for the
   * fixed three, whose size comes from the table — the database refuses to
   * store it against them at all.
   */
  sheetsPerBundle?: number | null | undefined;
  /** How many pieces each parent sheet is cut into before it reaches the press. */
  parts: number | null | undefined;
};

export type PaperCount = {
  /**
   * What leaves the godown: whole parent sheets, before the guillotine.
   *
   * This is the figure paper is bought and issued against, and the one costing
   * and any future IMS will need. Null when there is not enough typed in to
   * know it.
   */
  parentSheets: number | null;
  /**
   * What the press runs: parent sheets after cutting.
   *
   * Cutting happens BEFORE printing — the parent sheet is cut down to press
   * size — so this is a run length, not a finished-piece count.
   */
  pressSheets: number | null;
  /** Sheets in one bundle, so a screen can show its working. */
  sheetsPerBundle: number | null;
};

const EMPTY: PaperCount = { parentSheets: null, pressSheets: null, sheetsPerBundle: null };

/**
 * Both real quantities, from quantity × bundle × parts.
 *
 * NOTHING IS STORED. These are derived wherever they are shown, for the same
 * reason `pending_qty` is (non-negotiable 2): a stored copy is right on the day
 * it is written and wrong the first time somebody corrects the quantity, and it
 * looks equally authoritative on both days.
 *
 * A quantity with no bundle computes nothing rather than guessing a bundle. The
 * database refuses that combination too (`job_card_paper_bundle_required`), so
 * this is the same rule stated in the place the person can see it.
 *
 * Parts defaults to 1 — uncut is the ordinary case, and a blank parts box means
 * "not cut", never "unknown".
 */
export function paperCount({ qty, bundle, sheetsPerBundle: typed, parts }: PaperInput): PaperCount {
  if (!bundle) return EMPTY;

  const sheetsPerBundle = sheetsInBundle(bundle, typed);

  // A manual bundle with no size typed yet knows nothing, not even its
  // multiplier — so it reports nothing rather than a half-answer.
  if (sheetsPerBundle === null) return EMPTY;

  if (qty === null || qty === undefined || !Number.isFinite(qty) || qty <= 0) {
    return { ...EMPTY, sheetsPerBundle };
  }

  const parentSheets = qty * sheetsPerBundle;

  // Zero or negative parts is not "cut into nothing", it is a typo. Fall back
  // to uncut rather than reporting a press run of zero sheets.
  const divisions = parts !== null && parts !== undefined && parts > 0 ? parts : 1;

  return { parentSheets, pressSheets: parentSheets * divisions, sheetsPerBundle };
}

/**
 * "5 packets", "2 gross" — the quantity as the trade says it.
 *
 * GROSS DOES NOT PLURALISE. Two gross is two gross, never "two grosss", and a
 * card printing that reads as a typo in a system rather than a quantity.
 */
function bundleWords(qty: number, bundle: PaperBundle): string {
  const unit = bundle.toLowerCase();
  if (bundle === "Gross") return `${qty} ${unit}`;
  return `${qty} ${unit}${qty === 1 ? "" : "s"}`;
}

/** "5 packets × 100" — how the parent-sheet figure was arrived at. */
export function paperWorking({
  qty,
  bundle,
  sheetsPerBundle,
}: Pick<PaperInput, "qty" | "bundle" | "sheetsPerBundle">): string | null {
  if (!bundle || qty === null || qty === undefined || qty <= 0) return null;

  const size = sheetsInBundle(bundle, sheetsPerBundle);
  if (size === null) return null;

  return `${bundleWords(qty, bundle)} × ${size}`;
}

/** "5 packets" — the quantity as the godown says it, for a printed slot. */
export function paperQuantityLine({
  paperQty,
  paperBundle,
}: {
  paperQty: number | null;
  paperBundle: PaperBundle | null;
}): string | null {
  if (paperQty === null || !paperBundle) return null;
  return bundleWords(paperQty, paperBundle);
}

/**
 * "1 (uncut)" or "2" — how many pieces the parent sheet is cut into.
 *
 * A blank parts box and a parts of 1 are the SAME FACT: the sheet is not cut.
 * Printing them two different ways on the same card invites somebody to read a
 * difference into it that is not there.
 */
export function partsLine(parts: number | null | undefined): string {
  return parts !== null && parts !== undefined && parts > 1 ? String(parts) : "1 (uncut)";
}

