import { similarity } from "@/modules/imports/match";

/**
 * "DID YOU MEAN" FOR A TYPED ITEM NAME (decision U2).
 *
 * The importer has had tolerant client-name matching since F32, because a
 * paper book saying "NATUREEXPERT AYURVEDIC PVT LTD" against a list saying
 * "Natureexpert Ayurvedic" is not a difference anybody would call a
 * difference. The same problem arrives through the capture form the moment an
 * item name is TYPED rather than picked — and on the manual-job-card path it
 * always is.
 *
 * The failure is quiet and expensive. "Urea Foot Cream Carton" typed twice,
 * once with a trailing space and once without, is two items as far as every
 * rollup is concerned: the design order book splits, `/items/by-name` shows
 * two rows, and the pending figure for one product is in two places. Nobody
 * notices until somebody counts.
 *
 * SO THIS WARNS AND NEVER BLOCKS. It is the spell-check Utkarsh asked for, not
 * a validation rule: it puts the near-matches under the field and leaves the
 * decision alone. A genuinely new size or variant is a perfectly good reason
 * to type something that resembles an existing name, and a form that refused
 * it would be wrong far more often than it was right.
 *
 * It reuses `similarity` from the importer rather than growing a second
 * measure. One definition of "alike" across the system is worth more than one
 * tuned per screen, and that one is already calibrated and tested.
 *
 * Pure functions over strings, deliberately: this runs in the browser as the
 * person types, against items already loaded for the chosen client, so there
 * is no round trip and no server query per keystroke.
 */

/**
 * Normalised for comparison: case, spacing and punctuation folded away.
 *
 * NOT `normaliseClientName`, which also strips legal suffixes — "Pvt Ltd" at
 * the end of a company is noise, but a trailing word in a product name is the
 * thing that distinguishes "Carton" from "Carton Insert".
 */
export function normaliseItemName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The line at which a typed name is close enough to an existing one to be
 * worth a glance.
 *
 * HIGHER THAN THE IMPORTER'S 0.45, and for a reason that runs the other way.
 * The importer is deciding whether to CREATE A CUSTOMER — a wrong answer there
 * splits a client's whole history, so it errs low and sends plenty to review.
 * Here the cost of a false positive lands on somebody mid-sentence in a form,
 * and item names within one client share far more words than client names do:
 * "Carton 50g", "Carton 100g" and "Carton Insert" are all genuinely different
 * products that score high against each other. Erring low here would put a
 * warning under the field almost every time and train people past it, which
 * is worse than no warning at all.
 */
export const ITEM_NAME_THRESHOLD = 0.6;

export type NamedItem = {
  poItemId: string;
  itemCode: string;
  itemName: string;
  status: string;
  poInternalNo: string;
};

export type NearName<T extends NamedItem = NamedItem> = {
  item: T;
  score: number;
  /** Same name once case, spacing and punctuation are folded away. */
  exact: boolean;
};

/**
 * Existing items of this client whose name resembles what is being typed,
 * closest first.
 *
 * An EXACT normalised match is always returned and always ranked first,
 * whatever else scores well. It is the most useful thing this can say — the
 * item already exists, so this is probably a repeat and the form has a Repeat
 * control for that — and it is the case a threshold could otherwise bury under
 * three near-misses.
 *
 * Returns nothing for a name too short to judge. Two or three characters
 * resemble half the catalogue, and a warning that fires on every first
 * keystroke is one nobody reads by the fourth.
 */
export function nearbyItemNames<T extends NamedItem>(
  typed: string,
  existing: readonly T[],
  limit = 3,
): NearName<T>[] {
  const target = normaliseItemName(typed);
  if (target.length < 4) return [];

  const scored: NearName<T>[] = [];

  for (const item of existing) {
    const other = normaliseItemName(item.itemName);
    if (other.length === 0) continue;

    const exact = other === target;
    const score = exact ? 1 : similarity(target, other);
    if (!exact && score < ITEM_NAME_THRESHOLD) continue;

    scored.push({ item, score, exact });
  }

  scored.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    // Stable and meaningful: the newest item code wins a genuine tie, so the
    // suggestion is the most recent spelling rather than an arbitrary one.
    return b.item.itemCode.localeCompare(a.item.itemCode);
  });

  return scored.slice(0, limit);
}
