import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { formatCommittedDate, formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { indexGroups, indexSummary } from "@/modules/purchase-orders/item-index";
import { listItemsForIndex } from "@/modules/purchase-orders/queries";

export const metadata: Metadata = { title: "By item · JSS MIS" };

function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

/**
 * The reconciliation pass (N5).
 *
 * Every item name, per client, with what is owed against it across every
 * purchase order — and a flag on anything that cannot be true. It answers two
 * questions in one reading: how wrong are the imported delivery figures, and
 * which names are really one product.
 *
 * NOTHING HERE WRITES. It is a reading, deliberately: the point is to size the
 * problem before choosing a way to fix it, and a screen that offered to fix
 * things would invite fixing them one at a time before anybody knows whether
 * there are twelve or four hundred.
 */
export default async function ByNamePage() {
  await requireAccess("item_tracker");

  const groups = indexGroups(await listItemsForIndex());
  const summary = indexSummary(groups);

  return (
    <div>
      <Link href="/items" className="text-muted-foreground text-[13px] hover:underline">
        ← Item tracker
      </Link>
      <h1 className="page-title mt-2">By item</h1>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Every item name a client has ordered, with what is still owed against it across all
        their purchase orders. Anything impossible is flagged and sorted to the top. This
        screen only reads — nothing here changes a figure.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <Figure label="Distinct items" value={formatQty(summary.groups)} />
        <Figure label="Ordered more than once" value={formatQty(summary.repeated)} />
        <Figure label="Still pending" value={formatQty(summary.pendingQty)} />
        <Figure
          label="Over-delivered"
          value={formatQty(summary.overDelivered)}
          tone={summary.overDelivered > 0 ? "text-overdue" : undefined}
        />
        <Figure
          label="Closed but owing"
          value={formatQty(summary.closedButOwing)}
          tone={summary.closedButOwing > 0 ? "text-overdue" : undefined}
        />
        <Figure
          label="Spelled more than one way"
          value={formatQty(summary.multipleSpellings)}
          tone={summary.multipleSpellings > 0 ? "text-at-risk" : undefined}
        />
        <Figure label="Not yet indexed" value={formatQty(summary.unlinked)} />
        <Figure label="Items in total" value={formatQty(summary.items)} />
      </dl>

      {groups.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-[13px]">No items yet.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {groups.map((g) => {
            const flagged = g.overDelivered.length > 0 || g.closedButOwing.length > 0;
            return (
              <details
                key={`${g.clientId}:${g.name}`}
                open={flagged}
                className={cn("rounded-lg border p-4", flagged && "border-overdue/40")}
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-muted-foreground text-[12px] tabular-nums">
                        {g.clientCode}
                      </span>
                      <span className="text-sm font-medium">{g.name}</span>
                      {g.spellings > 1 ? (
                        <span className="text-at-risk text-[11px]">
                          {g.spellings} spellings
                        </span>
                      ) : null}
                      {g.overDelivered.length > 0 ? (
                        <span className="text-overdue text-[11px]">over-delivered</span>
                      ) : null}
                      {g.closedButOwing.length > 0 ? (
                        <span className="text-overdue text-[11px]">closed but owing</span>
                      ) : null}
                    </div>
                    <p className="text-[13px] tabular-nums">
                      <span className="text-muted-foreground">
                        {g.items.length} item{g.items.length === 1 ? "" : "s"} ·{" "}
                        {g.purchaseOrders} PO{g.purchaseOrders === 1 ? "" : "s"} ·{" "}
                        {formatQty(g.orderedQty)} ordered ·{" "}
                        {formatQty(g.dispatchedQty)} sent ·{" "}
                      </span>
                      <span className={cn("font-medium", g.pendingQty < 0 && "text-overdue")}>
                        {formatQty(g.pendingQty)} pending
                      </span>
                    </p>
                  </div>
                </summary>

                <div className="mt-3 overflow-x-auto">
                  <table className="data-grid w-full">
                    <thead>
                      <tr>
                        <th className="px-2">Item</th>
                        <th className="px-2">Name as typed</th>
                        <th className="px-2">PO</th>
                        <th className="px-2">Committed</th>
                        <th className="px-2 text-right">Ordered</th>
                        <th className="px-2 text-right">Sent</th>
                        <th className="px-2 text-right">Pending</th>
                        <th className="px-2">Status</th>
                        <th className="px-2">Indexed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((i) => (
                        <tr key={i.poItemId}>
                          <td className="px-2">
                            <Link
                              href={`/items/${i.poItemId}`}
                              className="text-primary tabular-nums hover:underline"
                            >
                              {i.itemCode}
                            </Link>
                          </td>
                          <td
                            className={cn(
                              "px-2",
                              i.itemName !== g.name && "text-at-risk",
                            )}
                          >
                            {i.itemName}
                          </td>
                          <td className="px-2">
                            <Link
                              href={`/purchase-orders/${i.purchaseOrderId}`}
                              className="text-primary tabular-nums hover:underline"
                            >
                              {i.poInternalNo}
                            </Link>
                            <span className="text-muted-foreground block text-[11px]">
                              {formatDate(i.poDate)}
                            </span>
                          </td>
                          <td className="px-2 whitespace-nowrap">
                            {formatCommittedDate(i.committedDate)}
                          </td>
                          <td className="px-2 text-right tabular-nums">
                            {formatQty(i.orderedQty)}
                          </td>
                          <td className="px-2 text-right tabular-nums">
                            {formatQty(i.dispatchedQty)}
                          </td>
                          <td
                            className={cn(
                              "px-2 text-right tabular-nums",
                              i.pendingQty < 0 && "text-overdue font-medium",
                            )}
                          >
                            {formatQty(i.pendingQty)}
                          </td>
                          <td className="px-2">{i.status}</td>
                          <td className="text-muted-foreground px-2 text-[11px]">
                            {i.designId ? "yes" : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
