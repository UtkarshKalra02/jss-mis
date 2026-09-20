import Link from "next/link";

import { DataTable } from "@/components/data-table/data-table";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stockColumns } from "@/modules/materials/columns";
import { statusTone } from "@/modules/materials/status";
import type { StockRow } from "@/modules/materials/queries";

/**
 * The stock list, in two layouts — the tooling register's rule (I8): both
 * rendered, CSS decides, no flash of the wrong one.
 *
 * The phone layout exists because the store is where a phone gets used: at
 * the shelf, checking what is left before issuing. Stock leads on the card
 * because that is the answer; status follows because it is the judgement.
 */
export function StockList({ rows, emptyMessage }: { rows: StockRow[]; emptyMessage: string }) {
  return (
    <>
      <div className="hidden md:block">
        <DataTable columns={stockColumns} data={rows} emptyMessage={emptyMessage} />
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.length === 0 ? (
          <li className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-[13px]">
            {emptyMessage}
          </li>
        ) : null}
        {rows.map((r) => (
          <li key={r.materialId}>
            <Link
              href={`/materials/${r.materialId}`}
              className="hover:border-primary/40 block rounded-lg border p-3 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn("text-sm font-medium", !r.isActive && "text-muted-foreground line-through")}>
                  {r.name}
                </p>
                <p className="shrink-0 text-lg font-semibold tabular-nums">
                  {formatQty(r.closingStock)}
                  <span className="text-muted-foreground ml-1 text-[11px] font-normal">{r.unit}</span>
                </p>
              </div>
              <p className="text-muted-foreground mt-0.5 text-[12px] tabular-nums">
                {r.sku} · {r.typeName}
                {r.size ? ` · ${r.size}` : ""}
                {r.gsm ? ` · ${r.gsm} GSM` : ""}
              </p>
              <p className="mt-1 text-[12px]">
                <span className={statusTone(r.stockStatus)}>{r.stockStatus}</span>
                {r.daysRemaining !== null ? (
                  <span className="text-muted-foreground"> · {formatQty(r.daysRemaining)} days left</span>
                ) : null}
                {r.dueForIssue ? <span className="text-at-risk"> · due for issue</span> : null}
                {Number(r.inTransitQty) > 0 ? (
                  <span className="text-muted-foreground"> · {formatQty(r.inTransitQty)} in transit</span>
                ) : null}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
