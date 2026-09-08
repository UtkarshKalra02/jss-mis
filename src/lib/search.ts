import { and, or, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * The matching rule every search box in the MIS uses.
 *
 * EVERY TERM HAS TO MATCH SOMETHING; a term may match any of the fields. So
 * "kbc printing" finds that client's jobs at the press rather than everything
 * mentioning either word, and typing more words always narrows the screen.
 * Matching the whole phrase against each field instead — which is what a
 * single `%kbc printing%` does — finds nothing at all unless one column
 * happens to contain both words in that order, which is exactly the result
 * that teaches people to type one word and scroll.
 *
 * The fields are supplied per term rather than as a fixed list, because some
 * of them are not columns: a job card number lives across a junction table and
 * has to be matched with an EXISTS, and that subquery needs the term too.
 *
 * `%` and `_` are left alone. They are LIKE wildcards, so typing one broadens
 * the match rather than looking for the character — which nobody here does on
 * purpose, and which no search in the system has ever escaped.
 *
 * Returns undefined for a blank query, which is the shape drizzle's `and()`
 * ignores, so callers can pass it straight into a where clause.
 */
export function matchesEveryTerm(
  query: string,
  fieldsFor: (like: string) => (SQLWrapper | undefined)[],
): SQL | undefined {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return undefined;

  return and(...terms.map((term) => or(...fieldsFor(`%${term}%`))));
}
