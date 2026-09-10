/**
 * The pending-work report's vocabulary — and NOTHING ELSE IN THIS FILE.
 *
 * It has no imports, and that is the entire point. The filter panel is a
 * client component, and a `"use client"` file that imports a VALUE from a
 * module which reaches `@/db` drags the database driver and `env.ts` into the
 * browser bundle. `env.ts` validates DATABASE_URL at import time and throws
 * where there is none, so the page dies with "a client-side exception has
 * occurred" before it renders anything.
 *
 * That is exactly how this file came to exist: the panel imported `NO_STAGE`
 * from `items/queries` and the print route shipped 64 kB of server code to the
 * browser. `import type` is erased and was never the problem — a single value
 * import was.
 *
 * So anything the panel and the query BOTH need lives here, where there is
 * nothing to drag along.
 */

/** How the report orders its rows. Applied in SQL, never after grouping. */
export type ItemSortKey = "urgency" | "itemCode" | "client" | "pendingQty" | "stage";

/** How the report blocks its rows. There is no ungrouped option by choice. */
export type GroupBy = "stage" | "client" | "month";

/**
 * Sentinel for "no stage event yet", which no `IN` list can match.
 *
 * An item nobody has started is exactly what somebody filters for, so it is
 * tickable like any stage; the query splits this out and ORs an `IS NULL`
 * against the named stages.
 */
export const NO_STAGE = "__none__";

export const GROUP_LABELS: Record<GroupBy, string> = {
  stage: "Grouped by stage",
  client: "Grouped by client",
  month: "Grouped by month due",
};

export const SORT_LABELS: Record<ItemSortKey, string> = {
  urgency: "most urgent first",
  itemCode: "by item code",
  client: "by client",
  pendingQty: "largest quantity first",
  stage: "by stage order",
};
