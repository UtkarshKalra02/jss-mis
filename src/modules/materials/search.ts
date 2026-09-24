/**
 * Matching a typed query against the material list (P6).
 *
 * Separate from the picker component, and structurally typed rather than
 * importing MaterialOption, so the rule can be tested without a database or a
 * browser — the same reason the job card's paper arithmetic lives apart from
 * the form that shows it.
 *
 * EVERY WORD MUST MATCH SOMEWHERE, IN ANY ORDER. The store thinks in
 * dimensions and weights and says them in whatever order they come to mind:
 * "sbs 25x36 325" and "325 sbs 36" are the same request, and neither is the
 * order the material's name happens to be written in. A single substring
 * match over the whole name — which is what a browser's own dropdown does,
 * and only from the first character at that — finds neither.
 */

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

export function queryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every word of the query appears somewhere in the material. */
export function matchesQuery(text: string, words: string[]): boolean {
  return words.every((w) => text.includes(w));
}
