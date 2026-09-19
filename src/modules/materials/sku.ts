/**
 * SKU codes: P-SBS-001, CH-SOL-116 (decision O1).
 *
 * The sheet's own scheme, kept so every existing code imports unchanged:
 * category code, type code, and a number that runs PER PREFIX. Numbers are
 * three digits until they are not — 1000 SKUs of one board is not a case
 * worth refusing, so the padding is a minimum, not a width.
 *
 * Allocation is `max + 1` over live and removed rows alike, under an
 * advisory lock on the prefix (see allocateSku in actions.ts). A removed SKU
 * must not be reissued for a different item: a challan or a job card that
 * named it is still on paper somewhere.
 */

const SKU_PATTERN = /^([A-Z0-9]+)-([A-Z0-9]+)-(\d+)$/;

export function skuPrefix(categoryCode: string, typeCode: string): string {
  return `${categoryCode.toUpperCase()}-${typeCode.toUpperCase()}`;
}

export function formatSku(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** The running number of a SKU under a prefix, or null when it is not one. */
export function skuNumber(sku: string, prefix: string): number | null {
  const m = SKU_PATTERN.exec(sku.toUpperCase());
  if (!m) return null;
  if (`${m[1]}-${m[2]}` !== prefix.toUpperCase()) return null;
  return Number(m[3]);
}

/** Next number after the highest already used under this prefix. */
export function nextSkuNumber(existing: string[], prefix: string): number {
  let max = 0;
  for (const sku of existing) {
    const n = skuNumber(sku, prefix);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}
