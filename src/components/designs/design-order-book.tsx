import Link from "next/link";

import { formatCommittedDate, formatDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderBook } from "@/modules/designs/queries";

/**
 * How much of this design the client has on order, across every item (P7).
 *
 * THE TOTALS ARE READ, NOT STORED. N2 refused to grow one item's quantity
 * when a client re-orders, because a row cannot hold two promised dates and
 * the old row must keep saying what its purchase order said. The cost of that
 * decision was that nobody could see the whole picture in one place. This is
 * that place: the items stay separate and honest, and the sum is taken here.
 *
 * Every figure comes from the same view the Item Tracker reads, so pending
 * means here exactly what it means there.
 */
function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

export function DesignOrderBook({ book }: { book: OrderBook }) {
  if (book.rows.length === 0) {
    return (
      <section className="mt-6 rounded-lg border p-4">
        <h2 className="text-sm font-medium">On order</h2>
        <p className="text-muted-foreground mt-2 text-[13px]">
          No purchase order item has named this design yet.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border p-4">
      <h2 className="text-sm font-medium">On order</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        Every item raised against this design. A repeat is its own item with its own
        promised date, so the totals here are the sum of the rows below — never a figure
        typed onto one of them.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Ordered" value={formatQty(book.ordered)} />
        <Figure label="Dispatched" value={formatQty(book.dispatched)} />
        <Figure
          label="Still pending"
          value={formatQty(book.pending)}
          tone={book.pending > 0 ? "font-medium" : undefined}
        />
        <Figure
          label="Open items"
          value={
            book.overdue > 0 ? (
              <>
                {book.openItems}{" "}
                <span className="text-overdue text-[13px]">{book.overdue} overdue</span>
              </>
            ) : (
              book.openItems
            )
          }
        />
      </dl>

      <div className="mt-4 overflow-x-auto">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="px-2">Item</th>
              <th className="px-2">PO</th>
              <th className="px-2">Committed</th>
              <th className="px-2">Stage</th>
              <th className="px-2 text-right">Ordered</th>
              <th className="px-2 text-right">Sent</th>
              <th className="px-2 text-right">Pending</th>
            </tr>
          </thead>
          <tbody>
            {book.rows.map((r) => (
              <tr key={r.poItemId} className={cn(r.pendingQty === 0 && "text-muted-foreground")}>
                <td className="px-2">
                  <Link
                    href={`/items/${r.poItemId}`}
                    className="text-primary tabular-nums hover:underline"
                  >
                    {r.itemCode}
                  </Link>
                  <span className="text-muted-foreground ml-2 text-[12px]">{r.itemName}</span>
                </td>
                <td className="px-2">
                  <Link
                    href={`/purchase-orders/${r.purchaseOrderId}`}
                    className="text-primary tabular-nums hover:underline"
                  >
                    {r.clientPoNo ?? r.poInternalNo}
                  </Link>
                  {r.poAwaited ? (
                    <span className="text-at-risk ml-2 text-[11px]">PO awaited</span>
                  ) : null}
                  <span className="text-muted-foreground block text-[11px]">
                    {formatDate(r.poDate)}
                  </span>
                </td>
                <td
                  className={cn(
                    "px-2 whitespace-nowrap",
                    r.isOverdue ? "text-overdue" : r.isAtRisk ? "text-at-risk" : undefined,
                  )}
                >
                  {formatCommittedDate(r.committedDate)}
                </td>
                <td className="px-2">{r.currentStageName ?? r.status}</td>
                <td className="px-2 text-right tabular-nums">{formatQty(r.orderedQty)}</td>
                <td className="px-2 text-right tabular-nums">{formatQty(r.dispatchedQty)}</td>
                <td
                  className={cn(
                    "px-2 text-right tabular-nums",
                    r.pendingQty > 0 && "font-medium",
                  )}
                >
                  {formatQty(r.pendingQty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
