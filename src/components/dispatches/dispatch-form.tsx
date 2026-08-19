"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { StagePill } from "@/components/stages/stage-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dispatchStatusEnum } from "@/db/schema/enums";
import { todayIST } from "@/lib/dates";
import { formatCommittedDate, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClientOption } from "@/modules/designs/queries";
import { createDispatchAction, type FormState } from "@/modules/dispatches/actions";
import type { DispatchableItem } from "@/modules/dispatches/queries";

const initialState: FormState = { ok: false, error: null };

const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Dispatch entry — spec 6.8, entry only.
 *
 * DECISION F2 is the shape of this screen. The spec gates it on stage = READY;
 * applied literally that hides exactly the rows Phase 2 exists to enter, since
 * backfilled historical jobs arrive already delivered rather than at READY. So
 * every open item with pending quantity is listed, and the ones not at READY
 * carry a warning badge. Warn, never block.
 *
 * Quantities default to the full pending amount (spec 6.8) and are editable
 * for a partial delivery. A row left at zero is simply not on this challan —
 * the list is every candidate, not a list of intentions.
 */
export function DispatchForm({
  clients,
  items,
}: {
  clients: ClientOption[];
  items: DispatchableItem[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createDispatchAction, initialState);
  const formId = useId();

  const [clientId, setClientId] = useState("");
  const [dispatchDate, setDispatchDate] = useState(todayIST());

  /** poItemId -> typed quantity. Absent means "not on this challan". */
  const [qty, setQty] = useState<Record<string, string>>({});
  const [rate, setRate] = useState<Record<string, string>>({});

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  // A challan cannot mix clients — the database refuses it (C8) — so the item
  // list is scoped to the one chosen above.
  const forClient = items.filter((i) => i.clientId === clientId);
  const chosen = forClient.filter((i) => Number(qty[i.poItemId] ?? 0) > 0);
  const totalQty = chosen.reduce((sum, i) => sum + Number(qty[i.poItemId] ?? 0), 0);

  const fillAll = () =>
    setQty((current) => {
      const next = { ...current };
      for (const item of forClient) next[item.poItemId] = String(item.pendingQty);
      return next;
    });

  return (
    <form action={formAction} className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-medium">Challan</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-client`}>Client</Label>
            <select
              id={`${formId}-client`}
              name="clientId"
              required
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                // Quantities belong to the previous client's items.
                setQty({});
                setRate({});
              }}
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

          <div className="space-y-2">
            <Label htmlFor={`${formId}-date`}>Dispatch date</Label>
            <Input
              id={`${formId}-date`}
              name="dispatchDate"
              type="date"
              required
              value={dispatchDate}
              onChange={(e) => setDispatchDate(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              The date the goods left. It dates the DISPATCHED stage event too, so a
              back-dated challan reads as history.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-status`}>Status</Label>
            <select
              id={`${formId}-status`}
              name="status"
              defaultValue="Dispatched"
              className={inputClass}
            >
              {dispatchStatusEnum.enumValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {/* F22: a draft is typed but not gone. It consumes no order
                quantity and writes no stage events until it is promoted. */}
            <p className="text-muted-foreground text-xs">
              Draft means typed but not gone — the quantity stays owed until you mark it
              Dispatched.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-vehicle`}>Vehicle no</Label>
            <Input id={`${formId}-vehicle`} name="vehicleNo" placeholder="DL 1LR 1234" />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-transporter`}>Transporter</Label>
            <Input id={`${formId}-transporter`} name="transporter" />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-eway`}>E-way bill no</Label>
            <Input id={`${formId}-eway`} name="ewayBillNo" className="tabular-nums" />
          </div>

          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label htmlFor={`${formId}-remarks`}>Remarks</Label>
            <Input id={`${formId}-remarks`} name="remarks" />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Items going out</h2>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs tabular-nums">
              {chosen.length} line{chosen.length === 1 ? "" : "s"} · {formatQty(totalQty)} pcs
            </span>
            {forClient.length > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={fillAll}>
                Fill all pending
              </Button>
            ) : null}
          </div>
        </div>

        {!clientId ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-[13px]">
            Choose a client to see what they are owed.
          </p>
        ) : forClient.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-[13px]">
            Nothing pending for this client. Everything ordered has been delivered.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="data-grid w-full">
              <thead>
                <tr>
                  <th className="min-w-32 px-2">Item</th>
                  <th className="min-w-48 px-2">Name</th>
                  <th className="min-w-36 px-2">Stage</th>
                  <th className="px-2">Committed</th>
                  <th className="px-2 text-right">Ordered</th>
                  <th className="px-2 text-right">Pending</th>
                  <th className="w-28 px-2 text-right">Dispatch</th>
                  <th className="w-28 px-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {forClient.map((item) => {
                  const notReady = item.currentStage !== "READY";
                  const typed = qty[item.poItemId] ?? "";
                  const over = Number(typed || 0) > item.pendingQty;

                  return (
                    <tr key={item.poItemId}>
                      {/* Every row posts its id, so index alignment with the
                          quantity array holds even for untouched rows. */}
                      <td className="px-2 tabular-nums">
                        <input type="hidden" name="poItemId" value={item.poItemId} />
                        {item.itemCode}
                      </td>
                      <td className="px-2">{item.itemName}</td>

                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <StagePill
                            name={item.currentStageName}
                            colour={item.currentStageColour}
                          />
                          {/* F2: warn, never block. */}
                          {notReady ? (
                            <span
                              className="text-at-risk text-[11px]"
                              title="This item has not reached READY. You can still dispatch it."
                            >
                              not ready
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td
                        className={cn(
                          "px-2",
                          item.isOverdue && "text-overdue",
                          item.isAtRisk && "text-at-risk",
                          !item.committedDate && "text-muted-foreground text-[11px]",
                        )}
                      >
                        {formatCommittedDate(item.committedDate)}
                      </td>

                      <td className="px-2 text-right tabular-nums">
                        {formatQty(item.orderedQty)}
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {formatQty(item.pendingQty)}
                      </td>

                      <td className="px-2 py-1">
                        <input
                          name="qty"
                          type="number"
                          min={0}
                          max={item.pendingQty}
                          step={1}
                          value={typed}
                          onChange={(e) =>
                            setQty((c) => ({ ...c, [item.poItemId]: e.target.value }))
                          }
                          className={cn(
                            inputClass,
                            "text-right tabular-nums",
                            over && "border-overdue",
                          )}
                          aria-label={`Dispatch quantity for ${item.itemCode}`}
                          placeholder="0"
                        />
                      </td>

                      <td className="px-2 py-1">
                        <input
                          name="rate"
                          type="number"
                          min={0}
                          step="0.01"
                          value={rate[item.poItemId] ?? item.rate ?? ""}
                          onChange={(e) =>
                            setRate((c) => ({ ...c, [item.poItemId]: e.target.value }))
                          }
                          className={`${inputClass} text-right tabular-nums`}
                          aria-label={`Rate for ${item.itemCode}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {state.error ? (
        <p role="alert" className="text-overdue text-sm">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-on-time text-sm">
          {state.message}
        </p>
      ) : null}

      <Submit label="Save challan" />
    </form>
  );
}
