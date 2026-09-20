/**
 * Colour for a stock status (P2) — semantic only, section 7: red for
 * Critical, amber for Order now / Low, green for OK, grey for the rest.
 * A plain module, importable from server and client components alike.
 */
export function statusTone(status: string): string {
  if (status.startsWith("Critical")) return "text-overdue";
  if (status === "Order now" || status === "Low") return "text-at-risk";
  if (status === "OK") return "text-on-time";
  return "text-muted-foreground";
}
