import { describe, expect, it } from "vitest";

import {
  matchesQuery,
  queryWords,
  searchText,
  type SearchableMaterial,
} from "@/modules/materials/search";

/** Real rows from the store, shortened to the fields the search reads. */
const SBS: SearchableMaterial = {
  sku: "P-SBS-007",
  name: "Sbs Paper 25X36 325Gsm Cream",
  typeName: "SBS",
  categoryName: "Paper",
  size: "25X36",
  gsm: "325",
  finish: "Cream",
};
const DUPLEX: SearchableMaterial = {
  sku: "P-SBS-057",
  name: "Duplex 23X36 250Gsm Gray Back",
  typeName: "Duplex",
  categoryName: "Paper",
  size: "23X36",
  gsm: "250",
  finish: "Gray Back",
};
const INK: SearchableMaterial = {
  sku: "CH-SOL-116",
  name: "Nova Nol Xtra",
  typeName: "Solvent",
  categoryName: "Chemical",
  size: null,
  gsm: null,
  finish: null,
};

const finds = (m: SearchableMaterial, query: string) => matchesQuery(searchText(m), queryWords(query));

/**
 * The bug this replaced: a browser's <select> jumps only on the first
 * characters of an option, and every option begins with its SKU — so nobody
 * could type their way to a paper at all.
 */
describe("finding a material by typing (P6)", () => {
  it("matches words in any order, across name, size and GSM", () => {
    for (const q of ["sbs 25x36 325", "325 sbs 36", "25x36 cream", "cream sbs"]) {
      expect(finds(SBS, q), q).toBe(true);
    }
  });

  it("ignores case and extra spacing", () => {
    expect(finds(SBS, "  SBS   CREAM ")).toBe(true);
    expect(finds(DUPLEX, "GRAY back")).toBe(true);
  });

  it("finds by SKU, which is what the old dropdown could do", () => {
    expect(finds(SBS, "P-SBS-007")).toBe(true);
    // A fragment of the SKU works too, because matching is substring-based.
    expect(finds(SBS, "sbs-007")).toBe(true);
    expect(finds(SBS, "p-sbs-057")).toBe(false);
    expect(finds(INK, "ch-sol-116")).toBe(true);
  });

  it("matches a material with no size, GSM or finish", () => {
    expect(finds(INK, "nova nol")).toBe(true);
    expect(finds(INK, "solvent xtra")).toBe(true);
  });

  it("every word has to match, so a wrong word rules a material out", () => {
    expect(finds(SBS, "sbs 25x36 250")).toBe(false);
    expect(finds(DUPLEX, "duplex cream")).toBe(false);
    expect(finds(INK, "nova paper")).toBe(false);
  });

  it("separates the two papers a single-word search would confuse", () => {
    expect(finds(SBS, "25x36")).toBe(true);
    expect(finds(DUPLEX, "25x36")).toBe(false);
  });

  it("an empty query has no words, so nothing is filtered out", () => {
    expect(queryWords("   ")).toEqual([]);
    expect(matchesQuery(searchText(SBS), [])).toBe(true);
  });
});
