"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { todayIST } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  createEnquiryAction,
  updateEnquiryAction,
  type FormState,
} from "@/modules/enquiries/actions";
import type { EnquiryRow, OwnerOption, SourceOption } from "@/modules/enquiries/queries";
import { enquiryLostReasons, enquiryStatuses } from "@/modules/enquiries/validation";
import type { ClientOption } from "@/modules/designs/queries";

const initialState: FormState = { ok: false, error: null };

const fieldClass =
  "border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

const areaClass =
  "border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * The enquiry form, for both new and edit.
 *
 * The one piece of behaviour worth naming: LOST REASON APPEARS ONLY WHEN THE
 * STATUS IS LOST, and becomes required at that moment. It is enforced three
 * deep — rendered conditionally here, refused by the zod schema, and refused
 * by the `enquiry_lost_reason_required` CHECK in the database, which is the
 * one that survives a script (non-negotiable 4).
 *
 * Because the field is conditionally rendered it is ABSENT from the FormData
 * most of the time, which is the null-versus-undefined trap that silently
 * broke every delegation status change until it was found. The schema's
 * `absentOrBlank` is what handles it; this comment is here so the next person
 * to add a conditional field knows to use it.
 */
export function EnquiryForm({
  clients,
  sources,
  owners,
  defaultOwnerId,
  enquiry,
}: {
  clients: ClientOption[];
  sources: SourceOption[];
  owners: OwnerOption[];
  /** Whoever is filling the form in, so the common case is one less choice. */
  defaultOwnerId: string;
  /** Absent when raising a new one. */
  enquiry?: EnquiryRow;
}) {
  const editing = Boolean(enquiry);
  const router = useRouter();

  const [state, formAction] = useActionState(
    editing ? updateEnquiryAction : createEnquiryAction,
    initialState,
  );

  const [status, setStatus] = useState<string>(enquiry?.status ?? "Open");
  const [sourceCode, setSourceCode] = useState<string>(
    sources.find((s) => s.id === enquiry?.sourceId)?.code ?? "",
  );

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  const isLost = status === "Lost";
  // Only a referral has somebody to name. Shown for OTHER too, because that is
  // where "an architect we did a job for" ends up.
  const showReferredBy = sourceCode === "REFERRAL" || sourceCode === "OTHER";

  return (
    <form action={formAction} className="max-w-3xl space-y-6">
      {editing ? <input type="hidden" name="id" value={enquiry!.id} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-medium">Client</span>
          <select
            name="clientId"
            required
            defaultValue={enquiry?.clientId ?? ""}
            className={fieldClass}
          >
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
                {c.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[13px] font-medium">Enquiry date</span>
          <input
            type="date"
            name="enquiryDate"
            required
            defaultValue={enquiry?.enquiryDate ?? todayIST()}
            className={fieldClass}
          />
          <span className="text-muted-foreground mt-1 block text-[12px]">
            The day they asked. The enquiry number takes its financial year from this,
            not from today.
          </span>
        </label>

        <label className="block">
          <span className="text-[13px] font-medium">Source</span>
          <select
            name="sourceId"
            required
            defaultValue={enquiry?.sourceId ?? ""}
            onChange={(e) =>
              setSourceCode(sources.find((s) => s.id === e.target.value)?.code ?? "")
            }
            className={fieldClass}
          >
            <option value="">Where did it come from?…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {showReferredBy ? (
          <label className="block">
            <span className="text-[13px] font-medium">
              Referred by <span className="text-muted-foreground font-normal">(optional)</span>
            </span>
            <input
              name="referredBy"
              defaultValue={enquiry?.referredBy ?? ""}
              maxLength={200}
              placeholder="Who sent them"
              className={fieldClass}
            />
          </label>
        ) : (
          <div />
        )}
      </div>

      <label className="block">
        <span className="text-[13px] font-medium">What are they asking for?</span>
        <textarea
          name="itemDescription"
          required
          rows={3}
          maxLength={1000}
          defaultValue={enquiry?.itemDescription ?? ""}
          placeholder="Mono carton, 300gsm SBS, 4+0 with matt lamination and spot UV"
          className={areaClass}
        />
        <span className="text-muted-foreground mt-1 block text-[12px]">
          Free text, in their words. There is no design yet — that comes after the
          quotation.
        </span>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-medium">
            Quantity <span className="text-muted-foreground font-normal">(optional)</span>
          </span>
          <input
            type="number"
            name="qty"
            min={1}
            step={1}
            defaultValue={enquiry?.qty ?? ""}
            placeholder="If they said one"
            className={cn(fieldClass, "tabular-nums")}
          />
        </label>

        <label className="block">
          <span className="text-[13px] font-medium">
            Client wants it by{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </span>
          <input
            type="date"
            name="clientRequiredDate"
            defaultValue={enquiry?.clientRequiredDate ?? ""}
            className={fieldClass}
          />
          {/* K4, said out loud on the screen where somebody might otherwise
              assume it becomes a promise. */}
          <span className="text-muted-foreground mt-1 block text-[12px]">
            What they asked for, not what we have agreed. This never becomes the committed
            date on a PO.
          </span>
        </label>

        <label className="block">
          <span className="text-[13px] font-medium">Owner</span>
          <select
            name="ownerUserId"
            required
            defaultValue={enquiry?.ownerUserId ?? defaultOwnerId}
            className={fieldClass}
          >
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground mt-1 block text-[12px]">
            Whose job it is to chase this.
          </span>
        </label>

        <label className="block">
          <span className="text-[13px] font-medium">Status</span>
          <select
            name="status"
            required
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={fieldClass}
          >
            {enquiryStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Appears only for Lost, and is required the moment it appears. */}
      {isLost ? (
        <div className="border-overdue/40 space-y-5 rounded-lg border p-4">
          <label className="block">
            <span className="text-[13px] font-medium">Why was it lost?</span>
            <select
              name="lostReason"
              required
              defaultValue={enquiry?.lostReason ?? ""}
              className={fieldClass}
            >
              <option value="">Choose a reason…</option>
              {enquiryLostReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground mt-1 block text-[12px]">
              Pick the honest one. Unknown is a real answer — a guessed reason poisons the
              count this field exists to feed.
            </span>
          </label>

          <label className="block">
            <span className="text-[13px] font-medium">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </span>
            <textarea
              name="lostNotes"
              rows={2}
              maxLength={1000}
              defaultValue={enquiry?.lostNotes ?? ""}
              placeholder="Anything worth remembering next time this client asks"
              className={areaClass}
            />
          </label>
        </div>
      ) : null}

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

      <div className="flex items-center gap-3">
        <Submit label={editing ? "Save changes" : "Record enquiry"} />
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
