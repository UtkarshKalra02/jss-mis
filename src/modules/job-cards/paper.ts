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
 * TYPED AGAINST THE ENUM ON PURPOSE. `Record<PaperBundle, number>` means
 * adding a fourth bundle to `paperBundleEnum` without a multiplier here is a
 * compile error rather than a form that silently computes nothing — the same
 * guard the audit wrapper uses to keep its boundaries from being widened
 * quietly (F1).
 *
 * A ream is 500 here. Mills that ship 480-sheet reams exist; when one turns up
 * it goes in Paper remarks until it is common enough to earn its own field,
 * which is the trade-off taken when `sheets_per_ream` was removed (J18).
 */
export const SHEETS_PER_BUNDLE: Record<PaperBundle, number> = {
  Packet: 100,
  Ream: 500,
  Gross: 144,
};

export type PaperInput = {
  /** How many bundles. */
  qty: number | null | undefined;
  bundle: PaperBundle | null | undefined;
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
export function paperCount({ qty, bundle, parts }: PaperInput): PaperCount {
  if (!bundle) return EMPTY;

  const sheetsPerBundle = SHEETS_PER_BUNDLE[bundle];

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
export function paperWorking({ qty, bundle }: Pick<PaperInput, "qty" | "bundle">): string | null {
  if (!bundle || qty === null || qty === undefined || qty <= 0) return null;

  return `${bundleWords(qty, bundle)} × ${SHEETS_PER_BUNDLE[bundle]}`;
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
