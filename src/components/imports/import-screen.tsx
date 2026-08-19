"use client";

import { AlertTriangle, CheckCircle2, Download, XCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  confirmImportAction,
  previewImportAction,
  type ConfirmState,
  type PreviewState,
} from "@/modules/imports/actions";
import { importableRows, type ValidationResult } from "@/modules/imports/validate";

const previewInitial: PreviewState = { ok: false, error: null };
const confirmInitial: ConfirmState = { ok: false, error: null };

function Submit({ label, variant }: { label: string; variant?: "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

/**
 * The importer — upload, preview, confirm.
 *
 * The preview is the point of the whole screen: nothing is written until
 * somebody has read a row-by-row verdict and pressed a second button. The
 * upload step touches no table at all.
 *
 * The parsed rows are carried back to the confirm step in a hidden field rather
 * than being re-uploaded. They are re-validated on the server before anything is
 * written, so what travels through the browser is a convenience, not a trust
 * boundary.
 */
export function ImportScreen() {
  const [preview, previewAction] = useActionState(previewImportAction, previewInitial);
  const [confirm, confirmAction] = useActionState(confirmImportAction, confirmInitial);

  // A finished import invalidates the preview it came from — leaving it on
  // screen invites a second click that would report everything as a duplicate.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (confirm.ok) setDismissed(true);
  }, [confirm.ok]);

  const result = dismissed ? undefined : preview.result;

  return (
    <div className="space-y-8">
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">1 · Start from the template</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          One row per job. The header row is locked so the columns stay in the shape the
          importer reads, and the example row is skipped rather than imported — you can leave
          it in place.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-3">
          <a href="/api/import/template" download>
            <Download className="size-4" /> Download template
          </a>
        </Button>
      </section>

      <form action={previewAction} className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">2 · Upload it</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Nothing is written yet. You will see every row and what will happen to it.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            onChange={() => setDismissed(false)}
            className="text-[13px] file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-[13px]"
            aria-label="Spreadsheet to import"
          />
          <Submit label="Check the file" variant="outline" />
        </div>

        {preview.error ? (
          <p role="alert" className="text-overdue mt-3 text-sm">
            {preview.error}
          </p>
        ) : null}
      </form>

      {confirm.error ? (
        <p role="alert" className="text-overdue text-sm">
          {confirm.error}
        </p>
      ) : null}
      {confirm.ok && confirm.message ? (
        <p role="status" className="text-on-time text-sm">
          {confirm.message}
        </p>
      ) : null}

      {result ? (
        <Preview
          result={result}
          filename={preview.filename ?? "import.xlsx"}
          confirmAction={confirmAction}
        />
      ) : null}
    </div>
  );
}

function Count({
  tone,
  label,
  value,
}: {
  tone: "ok" | "warning" | "error" | "neutral";
  label: string;
  value: number;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "ok" && "border-on-time/40",
        tone === "warning" && "border-at-risk/40",
        tone === "error" && "border-overdue/40",
      )}
    >
      <div
        className={cn(
          "text-[18px] tabular-nums",
          tone === "ok" && "text-on-time",
          tone === "warning" && "text-at-risk",
          tone === "error" && "text-overdue",
        )}
      >
        {value}
      </div>
      <div className="text-muted-foreground text-[11px] uppercase">{label}</div>
    </div>
  );
}

function Preview({
  result,
  filename,
  confirmAction,
}: {
  result: ValidationResult;
  filename: string;
  confirmAction: (formData: FormData) => void;
}) {
  const willWrite = importableRows(result);
  const { summary } = result;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">3 · Check, then confirm</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {filename} · {summary.total} row{summary.total === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Count tone="ok" label="Ready" value={summary.ok} />
        <Count tone="warning" label="With a note" value={summary.warning} />
        <Count tone="error" label="Refused" value={summary.error} />
        <Count tone="neutral" label="Already present" value={summary.duplicate} />
        <Count tone="neutral" label="Will be written" value={willWrite.length} />
      </div>

      {summary.unknownClients.length > 0 ? (
        <div className="border-overdue/40 rounded-lg border p-4">
          <h3 className="text-sm font-medium">
            {summary.unknownClients.length} client
            {summary.unknownClients.length === 1 ? "" : "s"} not in the system
          </h3>
          <p className="text-muted-foreground mt-1 text-[13px]">
            The importer never creates clients — three spellings of one customer is a mess
            nobody notices until a report is split three ways. Add these on the Clients
            screen, then upload the file again.
          </p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {summary.unknownClients.map((name) => (
              <li key={name} className="tabular-nums">
                {name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="w-16 px-3">Row</th>
              <th className="w-10 px-3"></th>
              <th className="px-3">Client</th>
              <th className="px-3">PO</th>
              <th className="px-3">Item</th>
              <th className="px-3 text-right">Ordered</th>
              <th className="px-3 text-right">Dispatched</th>
              <th className="min-w-72 px-3">What will happen</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.rowNumber}>
                <td className="text-muted-foreground px-3 tabular-nums">{row.rowNumber}</td>
                <td className="px-3">
                  {row.status === "ok" ? (
                    <CheckCircle2 className="text-on-time size-4" aria-label="Ready" />
                  ) : row.status === "warning" ? (
                    <AlertTriangle className="text-at-risk size-4" aria-label="Note" />
                  ) : (
                    <XCircle className="text-overdue size-4" aria-label="Refused" />
                  )}
                </td>
                <td className="px-3">{row.raw.clientName || "—"}</td>
                <td className="px-3 tabular-nums">{row.raw.poNo || "—"}</td>
                <td className="px-3">{row.raw.itemName || "—"}</td>
                <td className="px-3 text-right tabular-nums">{row.raw.orderedQty || "—"}</td>
                <td className="px-3 text-right tabular-nums">{row.raw.dispatchedQty || "—"}</td>
                <td
                  className={cn(
                    "px-3 text-[12px]",
                    row.status === "error" && "text-overdue",
                    row.status === "warning" && "text-at-risk",
                  )}
                >
                  {row.reasons.length > 0 ? row.reasons.join(" ") : "Will be imported."}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={confirmAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="filename" value={filename} />
        {/* Re-validated on the server before anything is written, so this is a
            convenience rather than a trust boundary. */}
        <input
          type="hidden"
          name="rows"
          value={JSON.stringify(result.rows.map((r) => r.raw))}
        />

        <Submit
          label={
            willWrite.length === 0
              ? "Nothing to import"
              : `Import ${willWrite.length} job${willWrite.length === 1 ? "" : "s"}`
          }
        />
        <span className="text-muted-foreground text-[13px]">
          {summary.error > 0
            ? `${summary.error} refused row${summary.error === 1 ? "" : "s"} will be left out. The rest still import.`
            : "This can be undone in one action afterwards."}
        </span>
      </form>
    </section>
  );
}
