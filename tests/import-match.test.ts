import { describe, expect, it } from "vitest";

import {
  buildClientIndex,
  clientCodeFor,
  matchClient,
  normaliseClientName,
  similarity,
  SIMILARITY_THRESHOLD,
} from "@/modules/imports/match";
import type { ClientLookup } from "@/modules/imports/validate";

/**
 * Client name matching, tested as a pure function (decision F32).
 *
 * These rules decide what reaches the CLIENT MASTER, which is the one table
 * where a mistake is invisible and permanent: a duplicate customer does not
 * error, it just quietly splits a report in two. So they are tested directly —
 * no database, no spreadsheet, no session.
 */

const client = (id: string, code: string, name: string): ClientLookup => ({ id, code, name });

const NATURE = client("1", "NAT", "Nature Packaging Pvt Ltd");
const AYURVEDIC = client("2", "AYU", "Natureexpert Ayurvedic");
const MULTI = client("3", "MUL", "Multiprint Industries");
const AARAV = client("4", "AAR", "Aarav Cartons");
const BHARAT = client("5", "BHA", "Bharat Box Makers");

const INDEX = buildClientIndex([NATURE, AYURVEDIC, MULTI, AARAV, BHARAT]);

describe("normaliseClientName", () => {
  it("lowercases, trims and collapses internal whitespace", () => {
    expect(normaliseClientName("  Nature   PACKAGING  ")).toBe("nature packaging");
  });

  it("strips legal suffixes, one after another", () => {
    // The example from the requirement. Both sides reduce to the same thing,
    // which is the whole reason this function exists.
    expect(normaliseClientName("NATUREEXPERT AYURVEDIC PVT LTD")).toBe(
      normaliseClientName("Natureexpert Ayurvedic"),
    );

    expect(normaliseClientName("Acme Pvt. Ltd.")).toBe("acme");
    expect(normaliseClientName("Acme Private Limited")).toBe("acme");
    expect(normaliseClientName("Acme LLP")).toBe("acme");
    expect(normaliseClientName("Acme & Co")).toBe("acme");
    expect(normaliseClientName("Acme and Co.")).toBe("acme");
    expect(normaliseClientName("Acme Inc")).toBe("acme");
  });

  it("strips trailing punctuation", () => {
    expect(normaliseClientName("Acme Packaging,")).toBe("acme packaging");
    expect(normaliseClientName("Acme Packaging.")).toBe("acme packaging");
  });

  it("keeps a name that is nothing but a suffix", () => {
    // Stripping this to an empty string would make it match every other
    // stripped-to-empty name in the file.
    expect(normaliseClientName("Ltd")).toBe("ltd");
    expect(normaliseClientName("& Co")).toBe("& co");
  });
});

describe("similarity", () => {
  it("is 1 for identical strings and 0 for nothing in common", () => {
    expect(similarity("acme", "acme")).toBe(1);
    expect(similarity("acme", "")).toBe(0);
  });

  it("scores real variants above the threshold", () => {
    // These are the pairs the threshold was calibrated against. If a change
    // here drops one below the line, a duplicate client becomes reachable.
    const pairs: [string, string][] = [
      ["naturexpert ayurvedic", "natureexpert ayurvedic"],
      ["nature packagng", "nature packaging"],
      ["multiprint industry", "multiprint industries"],
      ["aarav carton", "aarav cartons"],
      ["shri balaji printers", "shree balaji printers"],
      ["amrit pharmaceuticals", "amrit pharma"],
    ];

    for (const [a, b] of pairs) {
      expect(similarity(a, b), `${a} vs ${b}`).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    }
  });

  it("scores unrelated names far below the threshold", () => {
    const pairs: [string, string][] = [
      ["zenith graphics", "ganesh packaging"],
      ["mehta traders", "bharat box makers"],
      ["aarav cartons", "multiprint industries"],
    ];

    for (const [a, b] of pairs) {
      expect(similarity(a, b), `${a} vs ${b}`).toBeLessThan(0.2);
    }
  });
});

describe("matchClient", () => {
  it("matches on code, exactly", () => {
    expect(matchClient("NAT", INDEX)).toEqual({ kind: "matched", client: NATURE });
    expect(matchClient(" mul ", INDEX)).toEqual({ kind: "matched", client: MULTI });
  });

  it("matches an exact name once normalised, and says nothing about it", () => {
    // The requirement's own example.
    expect(matchClient("NATUREEXPERT AYURVEDIC PVT LTD", INDEX)).toEqual({
      kind: "matched",
      client: AYURVEDIC,
    });

    expect(matchClient("  nature   packaging  ", INDEX)).toEqual({
      kind: "matched",
      client: NATURE,
    });
  });

  it("creates a name that resembles nothing on file", () => {
    expect(matchClient("Zenith Graphics", INDEX)).toEqual({ kind: "create" });
    expect(matchClient("Mehta Traders", INDEX)).toEqual({ kind: "create" });
  });

  it("sends a near-match to review rather than creating or assuming", () => {
    // This is the entire point of F32: auto-create must not be able to produce
    // a duplicate client.
    const result = matchClient("Naturexpert Ayurvedic", INDEX);

    expect(result.kind).toBe("review");
    expect(result.kind === "review" && result.candidates[0]!.id).toBe(AYURVEDIC.id);
  });

  it("reviews a name wholly contained in an existing one, whatever it scores", () => {
    // "bharat box" against "bharat box makers" scores below the threshold
    // purely because of the length difference, and is the most likely
    // duplicate shape there is.
    const result = matchClient("Bharat Box", INDEX);

    expect(similarity("bharat box", "bharat box makers")).toBeLessThan(0.7);
    expect(result.kind).toBe("review");
    expect(result.kind === "review" && result.candidates[0]!.id).toBe(BHARAT.id);
  });

  it("offers at most three candidates, best first", () => {
    const crowded = buildClientIndex([
      client("a", "AC1", "Acme Packaging"),
      client("b", "AC2", "Acme Packaging Co"),
      client("c", "AC3", "Acme Packagers"),
      client("d", "AC4", "Acme Packing"),
      client("e", "AC5", "Acme Package"),
    ]);

    const result = matchClient("Acme Packagin", crowded);
    expect(result.kind).toBe("review");

    if (result.kind !== "review") return;
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(result.candidates[1]!.score);
  });

  it("refuses to choose when two clients normalise to the same name", () => {
    // A coin toss here attaches real orders to the wrong customer, silently.
    const twins = buildClientIndex([
      client("a", "ACM", "Acme Packaging"),
      client("b", "ACP", "Acme Packaging Pvt Ltd"),
    ]);

    const result = matchClient("Acme Packaging", twins);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.candidates).toHaveLength(2);
  });

  it("prefers a code match over a name that happens to look like one", () => {
    const both = buildClientIndex([
      client("a", "NAT", "Nature Packaging"),
      client("b", "XYZ", "Nat"),
    ]);

    expect(matchClient("NAT", both)).toEqual({
      kind: "matched",
      client: both.byCode.get("nat"),
    });
  });
});

describe("clientCodeFor", () => {
  it("uses the first three letters of the first word, as the existing codes do", () => {
    expect(clientCodeFor("Nature Packaging", new Set())).toBe("NAT");
    expect(clientCodeFor("multiprint industries", new Set())).toBe("MUL");
  });

  it("pads from later words when the first is short", () => {
    expect(clientCodeFor("J K Papers", new Set())).toBe("JKP");
  });

  it("numbers a collision rather than failing the import", () => {
    expect(clientCodeFor("Natureexpert Ayurvedic", new Set(["nat"]))).toBe("NAT2");
    expect(clientCodeFor("Natureexpert Ayurvedic", new Set(["nat", "nat2"]))).toBe("NAT3");
  });

  it("produces a code the client form would also accept", () => {
    // clientCodeSchema: 2–12 characters, A-Z, 0-9 and hyphens only.
    for (const name of ["Nature Packaging", "J K Papers", "श्री बालाजी", "123 Industries"]) {
      const code = clientCodeFor(name, new Set());
      expect(code, name).toMatch(/^[A-Z0-9-]{2,12}$/);
    }
  });
});
