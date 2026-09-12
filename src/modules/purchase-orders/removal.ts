/**
 * Whether a purchase order may be removed, and if not, why.
 *
 * Pure, so the rule is in one place and testable without a session: an order
 * is removable only while nothing on it has gone out the door. Cancelled and
 * closed items are not a bar in themselves — only a delivery is, because a
 * delivery has a challan with this item on it.
 */
export type RemovalBlocker = { itemCode: string; dispatchedQty: number };

export function removalBlockers(
  items: readonly { itemCode: string; dispatchedQty: number }[],
): RemovalBlocker[] {
  return items
    .filter((item) => item.dispatchedQty > 0)
    .map(({ itemCode, dispatchedQty }) => ({ itemCode, dispatchedQty }));
}
