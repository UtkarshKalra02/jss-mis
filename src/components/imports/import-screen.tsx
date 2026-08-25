"use client";

import { AlertTriangle, CheckCircle2, Download, HelpCircle, XCircle } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  confirmImportAction,
  previewImportAction,
  type ConfirmState,
  type PreviewState,
} from "@/modules/imports/actions";
import {
  clientsToCreate,
  importableRows,
  validateRows,
  CREATE_NEW,
  type ClientDecisions,
  type ClientLookup,
  type ValidatedRow,
  type ValidationResult,
} from "@/modules/imports/validate";

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
 * The importer — upload, preview, decide, confirm.
 *
 * The preview is the point of the whole screen: nothing is written until
 * somebody has read a row-by-row verdict and pressed a second button. The
 * upload step touches no table at all.
 *
 * VALIDATION RUNS HERE, in the browser, over the rows and lookups the upload
 * step returned. That is not a shortcut around the server — it is what lets a
 * review decision (F32) update the whole preview as it is made, without either
 * a round trip per click or a second copy of the rules living in the component.
 * `validateRows` is a pure function of strings and lookups, which is exactly
 * why it can run in both places. The confirm step re-runs it on the server
 * against freshly read lookups, and only what THAT pass accepts is written
 * (F30) — so what happens here is a display, never a decision.
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

  // Answers to the "is this the same client?" question, keyed by normalised
  // name (F32). Cleared whenever a new file arrives, since the keys belong to
  // the file that raised them.
  const [decisions, setDecisions] = useState<ClientDecisions>({});
  useEffect(() => {
    setDecisions({});
  }, [preview.rows]);

  const rows = preview.rows;
  const clients = preview.clients;
  const existingKeys = preview.existingKeys;

  const result = useMemo(() => {
    if (!rows || !clients || !existingKeys) return undefined;
    return validateRows(rows, {
      clients,
      existingKeys: new Set(existingKeys),
      decisions,
    });
  }, [rows, clients, existingKeys, decisions]);

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

      {result && !dismissed ? (
        <Preview
          result={result}
          clients={clients!}
          filename={preview.filename ?? "import.xlsx"}
          decisions={decisions}
          onDecide={(key, value) => setDecisions((d) => ({ ...d, [key]: value }))}
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
  tone: "ok" | "warning" | "review" | "error" | "neutral";
  label: string;
  value: number;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "ok" && "border-on-time/40",
        tone === "warning" && "border-at-risk/40",
        tone === "review" && "border-primary/40",
        tone === "error" && "border-overdue/40",
      )}
    >
      <div
        className={cn(
          "text-[18px] tabular-nums",
          tone === "ok" && "text-on-time",
          tone === "warning" && "text-at-risk",
          tone === "review" && "text-primary",
          tone === "error" && "text-overdue",
        )}
      >
        {value}
      </div>
      <div className="text-muted-foreground text-[11px] uppercase">{label}</div>
    </div>
  );
}

/**
 * The per-row client decision (F32).
 *
 * The control is rendered on every row that is waiting on the answer, but the
 * answer is stored against the NORMALISED NAME — so choosing on one row
 * settles every row spelling that client the same way. Two rows that normalise
 * to the same name cannot become two clients, which is the requirement, and
 * it is enforced by there being one place to put the answer rather than by
 * anybody remembering to keep the rows in step.
 */
function ClientChoice({
  row,
  chosen,
  onDecide,
}: {
  row: ValidatedRow;
  chosen: string | undefined;
  onDecide: (key: string, value: string) => void;
}) {
  const review = row.review!;
  const name = `client-decision-${review.key}`;

  return (
    <div className="space-y-1.5">
      <p>
        <span className="font-medium">{review.typed}</span> is close to an existing client,
        but not the same. Which is it?
      </p>

      {review.candidates.map((candidate) => (
        <label key={candidate.id} className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name={name}
            checked={chosen === candidate.id}
            onChange={() => onDecide(review.key, candidate.id)}
            className="accent-primary mt-0.5 size-3.5"
          />
          <span>
            Use <span className="font-medium">{candidate.name}</span>{" "}
            <span className="text-muted-foreground">
              [{candidate.code}] · {Math.round(candidate.score * 100)}% alike
            </span>
          </span>
        </label>
      ))}

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name={name}
          checked={chosen === CREATE_NEW}
          onChange={() => onDecide(review.key, CREATE_NEW)}
          className="accent-primary mt-0.5 size-3.5"
        />
        <span>
          Create <span className="font-medium">{review.typed}</span> as a new client
        </span>
      </label>
    </div>
  );
}

function Preview({
  result,
  clients,
  filename,
  decisions,
  onDecide,
  confirmAction,
}: {
  result: ValidationResult;
  clients: ClientLookup[];
  filename: string;
  decisions: ClientDecisions;
  onDecide: (key: string, value: string) => void;
  confirmAction: (formData: FormData) => void;
}) {
  const willWrite = importableRows(result);
  const willCreate = clientsToCreate(result);
  const { summary } = result;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">3 · Check, then confirm</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {filename} · {summary.total} row{summary.total === 1 ? "" : "s"} ·{" "}
          {clients.length} client{clients.length === 1 ? "" : "s"} on file
        </p>
      </div>

      {/* The client summary the requirement asks for, in one sentence, before
          anything else: what the import is about to do to the client master. */}
      <p className="text-[13px]">
        <span className="text-muted-foreground">Clients:</span>{" "}
        <span className="text-on-time">{summary.clients.matched} matched</span>,{" "}
        <span className={willCreate.length > 0 ? "text-at-risk" : "text-muted-foreground"}>
          {willCreate.length} will be created
        </span>
        ,{" "}
        <span
          className={
            summary.clients.needsReview > 0 ? "text-primary font-medium" : "text-muted-foreground"
          }
        >
          {summary.clients.needsReview} need{summary.clients.needsReview === 1 ? "s" : ""} review
        </span>
        .
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Count tone="ok" label="Ready" value={summary.ok} />
        <Count tone="warning" label="With a note" value={summary.warning} />
        <Count tone="review" label="Need review" value={summary.review} />
        <Count tone="error" label="Refused" value={summary.error} />
        <Count tone="neutral" label="Already present" value={summary.duplicate} />
        <Count tone="neutral" label="Will be written" value={willWrite.length} />
      </div>

      {summary.clients.needsReview > 0 ? (
        <div className="border-primary/40 rounded-lg border p-4">
          <h3 className="text-sm font-medium">
            {summary.clients.needsReview} client name
            {summary.clients.needsReview === 1 ? "" : "s"} need
            {summary.clients.needsReview === 1 ? "s" : ""} a decision
          </h3>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Each of these is close to a client already on file, but not identical. The
            importer will not guess: guessing wrong either attaches an order to the wrong
            customer or splits one customer in two. Choose on the row — the answer applies to
            every row spelling that client the same way. Undecided rows are left out of the
            import; the rest still go in.
          </p>
        </div>
      ) : null}

      {willCreate.length > 0 ? (
        <div className="border-at-risk/40 rounded-lg border p-4">
          <h3 className="text-sm font-medium">
            {willCreate.length} client{willCreate.length === 1 ? "" : "s"} will be created
          </h3>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Nothing on file resembles {willCreate.length === 1 ? "this name" : "these names"},
            so {willCreate.length === 1 ? "it is" : "they are"} new. Each is stored exactly as
            typed, with a generated code, and flagged as created by import so you can finish
            the record afterwards — filter the client list by “created by import, unreviewed”.
          </p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {willCreate.map((creation) => (
              <li key={creation.key}>
                {creation.name}{" "}
                <span className="text-muted-foreground">
                  · row{creation.rowNumbers.length === 1 ? "" : "s"}{" "}
                  {creation.rowNumbers.join(", ")}
                </span>
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
              <th className="min-w-96 px-3">What will happen</th>
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
                  ) : row.status === "review" ? (
                    <HelpCircle className="text-primary size-4" aria-label="Needs review" />
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
                    "px-3 py-2 text-[12px]",
                    row.status === "error" && "text-overdue",
                    row.status === "warning" && "text-at-risk",
                  )}
                >
                  {row.status === "review" ? (
                    <ClientChoice
                      row={row}
                      chosen={decisions[row.review!.key]}
                      onDecide={onDecide}
                    />
                  ) : row.reasons.length > 0 ? (
                    row.reasons.join(" ")
                  ) : (
                    "Will be imported."
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={confirmAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="filename" value={filename} />
        {/* Re-validated on the server before anything is written, so both of
            these are a convenience rather than a trust boundary. */}
        <input
          type="hidden"
          name="rows"
          value={JSON.stringify(result.rows.map((r) => r.raw))}
        />
        <input type="hidden" name="decisions" value={JSON.stringify(decisions)} />

        <Submit
          label={
            willWrite.length === 0
              ? "Nothing to import"
              : `Import ${willWrite.length} job${willWrite.length === 1 ? "" : "s"}`
          }
        />
        <span className="text-muted-foreground text-[13px]">
          {summary.review > 0
            ? `${summary.review} row${summary.review === 1 ? "" : "s"} still waiting on a client decision will be left out.`
            : summary.error > 0
              ? `${summary.error} refused row${summary.error === 1 ? "" : "s"} will be left out. The rest still import.`
              : "This can be undone in one action afterwards."}
        </span>
      </form>
    </section>
  );
}
