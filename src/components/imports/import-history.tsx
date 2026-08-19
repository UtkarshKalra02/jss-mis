"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { undoImportAction, type ConfirmState } from "@/modules/imports/actions";
import type { BatchRow } from "@/modules/imports/queries";

const initialState: ConfirmState = { ok: false, error: null };

function Undo({ batchId }: { batchId: string }) {
  const [state, formAction] = useActionState(undoImportAction, initialState);
  const { pending } = useFormStatus();

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="batchId" value={batchId} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Undo
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="text-overdue mt-1 text-[11px]">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time mt-1 text-[11px]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Import history — batch, date, user, rows imported, undo.
 *
 * Undo is offered only while a batch still has live rows. Once it has been
 * reversed the row stays, showing who reversed it and when: a batch that
 * happened and was withdrawn is part of the history, not an absence.
 */
export function ImportHistory({ batches }: { batches: BatchRow[] }) {
  if (batches.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-[13px]">
        Nothing imported yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="data-grid w-full">
        <thead>
          <tr>
            <th className="px-3">File</th>
            <th className="px-3">When</th>
            <th className="px-3">By</th>
            <th className="px-3 text-right">Rows</th>
            <th className="px-3 text-right">Imported</th>
            <th className="px-3 text-right">Skipped</th>
            <th className="px-3">Status</th>
            <th className="w-28 px-3"></th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id}>
              <td className="px-3">{batch.filename}</td>
              <td className="px-3">{formatDateTime(batch.createdAt)}</td>
              <td className="px-3">{batch.importedByName ?? "—"}</td>
              <td className="px-3 text-right tabular-nums">{batch.rowCount}</td>
              <td className="px-3 text-right tabular-nums">{batch.importedCount}</td>
              <td className="px-3 text-right tabular-nums">{batch.skippedCount}</td>
              <td className={cn("px-3", batch.undoneAt && "text-muted-foreground")}>
                {batch.undoneAt
                  ? `Undone by ${batch.undoneByName ?? "someone"}`
                  : `${batch.liveItems} live`}
              </td>
              <td className="px-3 py-1">
                {!batch.undoneAt && batch.liveItems > 0 ? <Undo batchId={batch.id} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
