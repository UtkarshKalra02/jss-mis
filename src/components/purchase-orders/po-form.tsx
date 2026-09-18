"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { QuickDesignDialog } from "@/components/designs/quick-design-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { jobTypeEnum, priorityEnum } from "@/db/schema/enums";
import { todayIST } from "@/lib/dates";
import { formatCommittedDate, formatQty } from "@/lib/format";
import { createPurchaseOrderAction, type FormState } from "@/modules/purchase-orders/actions";
import type { ClientOption } from "@/modules/designs/queries";
import type { DesignOption, OpenItemOption } from "@/modules/purchase-orders/queries";

import { PoAwaited } from "./po-awaited";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/** One editable row. `key` is local only — the server sees parallel arrays. */
type ItemDraft = {
  key: string;
  itemName: string;
  orderedQty: string;
  rate: string;
  committedDate: string;
  jobType: string;
  priority: string;
  designId: string;
  remarks: string;
};

let seq = 0;
const blankItem = (): ItemDraft => ({
  key: `row-${(seq += 1)}`,
  itemName: "",
  orderedQty: "",
  rate: "",
  committedDate: "",
  jobType: "New",
  priority: "Normal",
  designId: "",
  remarks: "",
});

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * A row pre-filled from an open item the client wants more of (N2).
 *
 * A NEW ROW, never a change to the old one. The new lot has its own committed
 * date and, when it arrives, its own PO; raising the old item's quantity would
 * measure the new promise against the old date and leave the late PO nothing
 * to attach to. What carries over is what does not change between lots — the
 * design, the name, the rate — and the job type is Repeat because that is
 * what it is. Quantity and date are left for the person to type, on purpose.
 */
function repeatOf(source: OpenItemOption): ItemDraft {
  return {
    ...blankItem(),
    itemName: source.itemName,
    designId: source.designId ?? "",
    rate: source.rate ?? "",
    jobType: "Repeat",
    remarks: `Repeat of ${source.itemCode}`,
  };
}

/**
 * PO capture — spec 6.3 — and, since N1, adding items whose PO has not come.
 *
 * `mode="item"` is the same form with the client PO number and the scan left
 * out: the order is saved with po_no blank, which is all "PO awaited" is, and
 * the number is recorded on the order's page when the document arrives. Same
 * rows, same validation, same required committed date. It is a mode rather
 * than a second component because the moment there are two capture forms one
 * of them stops requiring the committed date.
 *
 * Everything here is CONTROLLED React state rather than uncontrolled inputs.
 * That is not a style preference: the duplicate-PO-number question (F7) sends
 * the form back with a warning and asks the person to confirm, and a form whose
 * fields reset at that moment would throw away a ten-line purchase order to ask
 * about a typo. Rows also have to be addable and removable, which needs state
 * regardless.
 *
 * Committed date is `required` on every row (non-negotiable 6, F8). The column
 * is nullable so the historical importer can be honest about jobs that never
 * had one; this form is a human entry point and has no such excuse.
 */
export function PoForm({
  mode = "po",
  clients,
  designs,
  openItems,
}: {
  mode?: "po" | "item";
  clients: ClientOption[];
  designs: DesignOption[];
  /** Open items still owed quantity, every client — the repeat list (N2). */
  openItems: OpenItemOption[];
}) {
  const withoutPo = mode === "item";
  const router = useRouter();
  const [state, formAction] = useActionState(createPurchaseOrderAction, initialState);
  const formId = useId();

  const [clientId, setClientId] = useState("");
  const [poNo, setPoNo] = useState("");
  const [poDate, setPoDate] = useState(todayIST());
  const [fileUrl, setFileUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);

  // Designs created from the dialog, added here rather than refetched: the
  // page is a server component and re-rendering it would discard the half-typed
  // purchase order this form exists to protect.
  const [extraDesigns, setExtraDesigns] = useState<DesignOption[]>([]);

  // Which row asked for a new design. Null means the dialog is closed.
  const [newDesignFor, setNewDesignFor] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  const patch = (key: string, field: keyof ItemDraft, value: string) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  // A design belongs to one client, so only that client's are offered.
  const designsForClient = [...designs, ...extraDesigns].filter(
    (d) => d.clientId === clientId,
  );

  const selectedClient = clients.find((c) => c.id === clientId);
  const repeatsForClient = openItems.filter((i) => i.clientId === clientId);

  /*
   * The first row is created blank so the table is never empty. If it is
   * still untouched when a repeat is picked, it is replaced rather than left
   * as an empty row above the real one that the server would then refuse.
   */
  const addRepeat = (source: OpenItemOption) =>
    setItems((rows) => {
      const untouched =
        rows.length === 1 && rows[0]!.itemName === "" && rows[0]!.orderedQty === "";
      return untouched ? [repeatOf(source)] : [...rows, repeatOf(source)];
    });

  return (
    <form action={formAction} className="space-y-8">
      {withoutPo ? <input type="hidden" name="withoutPo" value="true" /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-medium">{withoutPo ? "Order" : "Purchase order"}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-client`}>Client</Label>
            <select
              id={`${formId}-client`}
              name="clientId"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Choose a client…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                  {c.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </div>

          {/* Both fields are POSTED in item mode too, empty and hidden, so
              the action parses one shape. Only what the person sees changes. */}
          {withoutPo ? (
            <>
              <input type="hidden" name="poNo" value="" />
              <input type="hidden" name="fileUrl" value="" />
              <div className="space-y-2">
                <Label>Client&rsquo;s PO</Label>
                <div className="flex h-9 items-center">
                  <PoAwaited />
                </div>
                <p className="text-muted-foreground text-xs">
                  Record the number on the order&rsquo;s page when it arrives — or move the
                  item onto the PO if it was captured separately.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-poNo`}>Client&rsquo;s PO number</Label>
              <Input
                id={`${formId}-poNo`}
                name="poNo"
                value={poNo}
                onChange={(e) => setPoNo(e.target.value)}
                placeholder="4500123456"
              />
              <p className="text-muted-foreground text-xs">
                As printed on their document. Leave blank if there isn&rsquo;t one.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-poDate`}>{withoutPo ? "Order date" : "PO date"}</Label>
            <Input
              id={`${formId}-poDate`}
              name="poDate"
              type="date"
              required
              value={poDate}
              onChange={(e) => setPoDate(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {withoutPo
                ? "The day the order was placed. Dates the opening stage event; replaced by the PO date when the PO is recorded."
                : "Decides the number series year, and dates the opening stage event."}
            </p>
          </div>

          {withoutPo ? null : (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-fileUrl`}>Scanned PO</Label>
              <Input
                id={`${formId}-fileUrl`}
                name="fileUrl"
                type="url"
                value={fileUrl}
                onChange={(e) => setFileUrl(e.target.value)}
                placeholder="https://drive.google.com/…"
              />
            </div>
          )}

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${formId}-notes`}>Notes</Label>
            <Input
              id={`${formId}-notes`}
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* N2: what this client is currently owed, each one a click from being
          a new row. Shown only once a client is chosen — before that there is
          nothing to repeat — and never when they have nothing open, because an
          empty table under a heading is a question rather than an answer. */}
      {clientId && repeatsForClient.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Repeat an open item</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Open items this client still has quantity owed on. Repeat one to add a new row
              with its design, name and rate filled in — the new quantity and committed date
              are yours to type. The existing item is not changed.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="data-grid w-full">
              <thead>
                <tr>
                  <th className="px-2">Item</th>
                  <th className="min-w-48 px-2">Name</th>
                  <th className="px-2">PO</th>
                  <th className="px-2 text-right">Ordered</th>
                  <th className="px-2 text-right">Pending</th>
                  <th className="px-2">Committed</th>
                  <th className="w-24 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {repeatsForClient.map((item) => (
                  <tr key={item.poItemId}>
                    <td className="px-2 tabular-nums">{item.itemCode}</td>
                    <td className="px-2">
                      {item.itemName}
                      {item.designCode ? (
                        <span className="text-muted-foreground ml-2 text-[11px] tabular-nums">
                          {item.designCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-2 tabular-nums">
                      {item.poInternalNo}
                      {item.poAwaited ? <PoAwaited className="ml-2" /> : null}
                    </td>
                    <td className="px-2 text-right tabular-nums">{formatQty(item.orderedQty)}</td>
                    <td className="px-2 text-right tabular-nums">{formatQty(item.pendingQty)}</td>
                    <td className="text-muted-foreground px-2 text-[12px]">
                      {formatCommittedDate(item.committedDate)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => addRepeat(item)}
                      >
                        Repeat
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Items</h2>
          <span className="text-muted-foreground text-xs">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="data-grid w-full">
            <thead>
              <tr>
                <th className="w-8 px-2"></th>
                <th className="min-w-52 px-2">Item name</th>
                <th className="min-w-40 px-2">Design</th>
                <th className="w-24 px-2 text-right">Qty</th>
                <th className="w-28 px-2 text-right">Rate</th>
                <th className="w-40 px-2">Committed date</th>
                <th className="w-24 px-2">Type</th>
                <th className="w-28 px-2">Priority</th>
                <th className="min-w-40 px-2">Remarks</th>
                <th className="w-10 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, index) => (
                <tr key={row.key}>
                  <td className="text-muted-foreground px-2 text-center tabular-nums">
                    {index + 1}
                  </td>

                  <td className="px-2 py-1">
                    <input
                      name="itemName"
                      required
                      value={row.itemName}
                      onChange={(e) => patch(row.key, "itemName", e.target.value)}
                      className={inputClass}
                      placeholder="250ml carton — outer"
                      aria-label={`Item name, row ${index + 1}`}
                    />
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <select
                        name="designId"
                        value={row.designId}
                        onChange={(e) => patch(row.key, "designId", e.target.value)}
                        className={inputClass}
                        aria-label={`Design, row ${index + 1}`}
                        disabled={!clientId}
                      >
                        <option value="">— none —</option>
                        {designsForClient.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.designCode} — {d.jobName}
                          </option>
                        ))}
                      </select>

                      {/* Spec 6.3: search existing OR create. The client has
                          to be chosen first — a design belongs to one. */}
                      <button
                        type="button"
                        onClick={() => setNewDesignFor(row.key)}
                        disabled={!clientId}
                        className="text-muted-foreground hover:text-primary shrink-0 disabled:opacity-30"
                        aria-label={`Create a design for row ${index + 1}`}
                        title={
                          clientId ? "Create a design" : "Choose the client first"
                        }
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </td>

                  <td className="px-2 py-1">
                    <input
                      name="orderedQty"
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={row.orderedQty}
                      onChange={(e) => patch(row.key, "orderedQty", e.target.value)}
                      className={`${inputClass} text-right tabular-nums`}
                      aria-label={`Quantity, row ${index + 1}`}
                    />
                  </td>

                  <td className="px-2 py-1">
                    <input
                      name="rate"
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.rate}
                      onChange={(e) => patch(row.key, "rate", e.target.value)}
                      className={`${inputClass} text-right tabular-nums`}
                      aria-label={`Rate, row ${index + 1}`}
                    />
                  </td>

                  {/* Non-negotiable 6. No skip, no default, no exception. */}
                  <td className="px-2 py-1">
                    <input
                      name="committedDate"
                      type="date"
                      required
                      value={row.committedDate}
                      onChange={(e) => patch(row.key, "committedDate", e.target.value)}
                      className={inputClass}
                      aria-label={`Committed date, row ${index + 1}`}
                    />
                  </td>

                  <td className="px-2 py-1">
                    <select
                      name="jobType"
                      value={row.jobType}
                      onChange={(e) => patch(row.key, "jobType", e.target.value)}
                      className={inputClass}
                      aria-label={`Job type, row ${index + 1}`}
                    >
                      {jobTypeEnum.enumValues.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-2 py-1">
                    <select
                      name="priority"
                      value={row.priority}
                      onChange={(e) => patch(row.key, "priority", e.target.value)}
                      className={inputClass}
                      aria-label={`Priority, row ${index + 1}`}
                    >
                      {priorityEnum.enumValues.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-2 py-1">
                    <input
                      name="remarks"
                      value={row.remarks}
                      onChange={(e) => patch(row.key, "remarks", e.target.value)}
                      className={inputClass}
                      aria-label={`Remarks, row ${index + 1}`}
                    />
                  </td>

                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => setItems((rows) => rows.filter((r) => r.key !== row.key))}
                      disabled={items.length === 1}
                      className="text-muted-foreground hover:text-overdue disabled:opacity-30"
                      aria-label={`Remove row ${index + 1}`}
                      title={
                        items.length === 1 ? "A PO needs at least one item" : "Remove this row"
                      }
                    >
                      <X className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setItems((rows) => [...rows, blankItem()])}
        >
          <Plus className="size-4" /> Add row
        </Button>
      </section>

      {/* One dialog, told which row asked for it. Rendered outside the table
          and portalled to the body by Radix, so its form is never nested
          inside this one. */}
      {newDesignFor && selectedClient ? (
        <QuickDesignDialog
          open
          onOpenChange={(open) => {
            if (!open) setNewDesignFor(null);
          }}
          clientId={clientId}
          clientLabel={`${selectedClient.code} — ${selectedClient.name}`}
          onCreated={(created) => {
            setExtraDesigns((list) => [...list, created]);
            patch(newDesignFor, "designId", created.id);
          }}
        />
      ) : null}

      {/* Section 7: inline, never a modal. */}
      {state.error ? (
        <p role="alert" className="text-overdue text-sm">
          {state.error}
        </p>
      ) : null}

      {/* F7: a duplicate PO number is a question, not a refusal. */}
      {state.warning ? (
        <div role="alert" className="border-at-risk/40 bg-at-risk-bg rounded-lg border p-4">
          <p className="text-sm">{state.warning}</p>
          {/* The confirmation rides on the BUTTON's own name/value rather than
              a hidden input driven by state. A click would submit before React
              re-rendered that input, so the confirmation would arrive one
              submit late — the form would ask the same question twice and the
              second answer would be the one that counted. */}
          <Button type="submit" name="confirmDuplicate" value="true" size="sm" variant="outline" className="mt-3">
            Save anyway
          </Button>
        </div>
      ) : null}

      {state.ok && state.message ? (
        <p role="status" className="text-on-time text-sm">
          {state.message}
        </p>
      ) : null}

      <Submit label={withoutPo ? "Add items" : "Capture purchase order"} />
    </form>
  );
}
