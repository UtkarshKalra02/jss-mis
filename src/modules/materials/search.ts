/**
 * What a material's text is, for the picker's search (P6).
 *
 * The matching RULE itself is `src/lib/search.ts` — every word must match
 * somewhere, in any order — and is shared with the repeat list. What is
 * material-specific, and stays here, is which fields a person might type at:
 * the store thinks in dimensions and weights, not only in names.
 */

export { matchesQuery, queryWords } from "@/lib/search";

export type SearchableMaterial = {
  sku: string;
  name: string;
  typeName: string | null;
  categoryName: string | null;
  size: string | null;
  /** Numeric in the stock view, text on older rows — both get typed at. */
  gsm: string | number | null;
  finish: string | null;
};

/** Everything about a material a person might type at it, lowercased. */
export function searchText(m: SearchableMaterial): string {
  return [m.sku, m.name, m.typeName, m.categoryName, m.size, m.gsm, m.finish]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
