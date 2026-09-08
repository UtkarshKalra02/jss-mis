import { PgDialect } from "drizzle-orm/pg-core";
import { ilike } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { client, jobCard, poItem } from "@/db/schema";
import { matchesEveryTerm } from "@/lib/search";

/**
 * The matching rule behind every search box (see `src/lib/search.ts`).
 *
 * Asserted against the SQL drizzle actually generates rather than against a
 * re-typed copy of the query, which is what the Item Tracker's own search test
 * has to do: `searchItems` reads the live database, so its fixtures cannot be
 * seen from inside a rolled-back transaction. Here there is no database in the
 * way, so the thing under test is the shipped function.
 *
 * The property that matters is the second test. One `%kbc printing%` matched
 * against each column in turn finds nothing unless a single column contains
 * both words in that order, which is what teaches people to type one word and
 * scroll rather than to narrow.
 */
const dialect = new PgDialect();

function render(query: string) {
  const condition = matchesEveryTerm(query, (like) => [
    ilike(jobCard.jcNo, like),
    ilike(poItem.itemCode, like),
    ilike(client.code, like),
  ]);

  return condition ? dialect.sqlToQuery(condition) : null;
}

describe("search term matching", () => {
  it("is no filter at all when the query is blank", () => {
    // undefined is the shape drizzle's and() drops, so a blank box does not
    // become `where true` or, worse, `where '%%'`.
    expect(render("")).toBeNull();
    expect(render("   ")).toBeNull();
  });

  it("wraps each term separately and requires all of them", () => {
    const q = render("kbc carton")!;

    expect(q.params).toEqual(["%kbc%", "%kbc%", "%kbc%", "%carton%", "%carton%", "%carton%"]);

    // Two OR groups, joined by AND: any field may satisfy a term, but every
    // term has to be satisfied by something.
    expect(q.sql).toMatch(/\band\b/i);
    expect(q.sql.match(/ilike/gi)).toHaveLength(6);
  });

  it("collapses runs of whitespace rather than searching for an empty term", () => {
    // "kbc  carton " is two terms. A stray space that became `%%` would match
    // every row and silently widen the search instead of narrowing it.
    expect(render("kbc  carton ")!.params).toEqual(render("kbc carton")!.params);
  });

  it("treats a single term exactly as the old single-phrase search did", () => {
    expect(render("JC-2026")!.params).toEqual(["%JC-2026%", "%JC-2026%", "%JC-2026%"]);
  });
});
