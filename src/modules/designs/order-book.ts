/**
 * Totalling a design's items (P7).
 *
 * Apart from the query so the arithmetic can be tested without a database —
 * and the arithmetic is the point. N2 refused to add a repeat's quantity onto
 * the item it repeats, because one row cannot hold two promised dates and the
 * old row must keep saying what its purchase order said. The sum still has to
 * exist somewhere; it exists here, as a reading of the rows.
 */

export type OrderBookItem = {
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  isOverdue: boolean;
};

export type OrderBookTotals = {
  ordered: number;
  dispatched: number;
  pending: number;
  /** Rows that still owe quantity — the same "open" the repeat picker uses. */
  openItems: number;
  overdue: number;
};

export function totalsFor(rows: readonly OrderBookItem[]): OrderBookTotals {
  return {
    ordered: rows.reduce((n, r) => n + r.orderedQty, 0),
    dispatched: rows.reduce((n, r) => n + r.dispatchedQty, 0),
    pending: rows.reduce((n, r) => n + r.pendingQty, 0),
    openItems: rows.filter((r) => r.pendingQty > 0).length,
    overdue: rows.filter((r) => r.isOverdue).length,
  };
}
