import type { IndexItem } from "./queries";

/**
 * Grouping every item by client and name — the reconciliation pass, and the
 * draft item index (N5).
 *
 * TWO JOBS IN ONE READING, deliberately. Utkarsh needs to know how wrong the
 * imported delivery figures are before deciding how to fix them, and he needs
 * to know which item names are really one product before anything can be
 * indexed. Both questions are answered by the same grouping, and asking them
 * together means reading the list once rather than twice.
 *
 * Grouping is per CLIENT as well as per name: two clients may both order a
 * "mono carton" and they are not the same product. That is also why the
 * design master this feeds is client-scoped.
 *
 * The name is folded on case and internal spacing, so "MASTER MONO CRT LTP
 * (6 +1)" and "Master Mono CRT LTP (6+1)" land together — that drift is the
 * ordinary result of the same thing being typed by different people over a
 * year, and it is exactly what an index is for. It cannot fold genuinely
 * different wording, and `spellings` says when it has folded anything, so a
 * group that merged two spellings is visible rather than silent.
 *
 * Pure, so the rules can be tested without a database.
 */

export type IndexGroup = {
  clientId: string;
  clientCode: string;
  clientName: string;
  /** The name as it is most commonly spelled in the group. */
  name: string;
  /** How many distinct spellings folded into this group. 1 means none did. */
  spellings: number;
  items: IndexItem[];
  purchaseOrders: number;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  /** Items already pointing at a design, and how many distinct ones. */
  designsLinked: number;
  distinctDesigns: number;

  /* The flags. Each names a thing that cannot be true, not a thing to judge. */

  /** More went out than was ordered — the lumped-delivery signature (K12). */
  overDelivered: IndexItem[];
  /** Settled, yet still owing. */
  closedButOwing: IndexItem[];
};

/** Case and spacing folded; the key two spellings of one product share. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function indexGroups(rows: IndexItem[]): IndexGroup[] {
  const buckets = new Map<string, IndexItem[]>();
  for (const row of rows) {
    const key = `${row.clientId}::${nameKey(row.itemName)}`;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const groups = [...buckets.values()].map((items): IndexGroup => {
    // The commonest spelling represents the group; ties go to the first seen,
    // which is the oldest item. Inventing a "correct" spelling would be this
    // file deciding what the factory calls its own product.
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.itemName, (counts.get(i.itemName) ?? 0) + 1);
    const name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];

    const designs = new Set(items.map((i) => i.designId).filter(Boolean));

    return {
      clientId: items[0]!.clientId,
      clientCode: items[0]!.clientCode,
      clientName: items[0]!.clientName,
      name,
      spellings: counts.size,
      items: [...items].sort((a, b) => (a.itemCode < b.itemCode ? -1 : 1)),
      purchaseOrders: new Set(items.map((i) => i.purchaseOrderId)).size,
      orderedQty: items.reduce((n, i) => n + i.orderedQty, 0),
      dispatchedQty: items.reduce((n, i) => n + i.dispatchedQty, 0),
      pendingQty: items.reduce((n, i) => n + i.pendingQty, 0),
      designsLinked: items.filter((i) => i.designId).length,
      distinctDesigns: designs.size,
      overDelivered: items.filter((i) => i.pendingQty < 0),
      closedButOwing: items.filter((i) => i.status === "Closed" && i.pendingQty > 0),
    };
  });

  /*
   * Worst first. The pass exists to be read from the top and stopped when it
   * stops being interesting, so anything impossible sorts above anything
   * merely large, and a group that is only a repeat sorts last.
   */
  const severity = (g: IndexGroup) =>
    (g.overDelivered.length > 0 ? 4 : 0) +
    (g.closedButOwing.length > 0 ? 2 : 0) +
    (g.spellings > 1 ? 1 : 0);

  return groups.sort(
    (a, b) =>
      severity(b) - severity(a) ||
      b.pendingQty - a.pendingQty ||
      (a.name < b.name ? -1 : 1),
  );
}

/** The headline the pass opens with: how much of this there is. */
export function indexSummary(groups: IndexGroup[]) {
  return {
    groups: groups.length,
    items: groups.reduce((n, g) => n + g.items.length, 0),
    repeated: groups.filter((g) => g.items.length > 1).length,
    overDelivered: groups.filter((g) => g.overDelivered.length > 0).length,
    closedButOwing: groups.filter((g) => g.closedButOwing.length > 0).length,
    multipleSpellings: groups.filter((g) => g.spellings > 1).length,
    unlinked: groups.filter((g) => g.designsLinked < g.items.length).length,
    pendingQty: groups.reduce((n, g) => n + g.pendingQty, 0),
  };
}
