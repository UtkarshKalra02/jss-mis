"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { formatCommittedDate } from "@/lib/format";
import {
  assignEnquiryOwnerAction,
  linkPurchaseOrderAction,
  removeEnquiryAction,
  setEnquiryStatusAction,
  unlinkPurchaseOrderAction,
  type FormState,
} from "@/modules/enquiries/actions";
import type { EnquiryRow, OwnerOption } from "@/modules/enquiries/queries";
import { enquiryLostReasons, enquiryStatuses } from "@/modules/enquiries/validation";

const initialState: FormState = { ok: false, error: null };

const fieldClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

function Submit({ label, variant }: { label: string; variant?: "outline" | "destructive" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-overdue mt-2 text-[13px]">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-on-time mt-2 text-[13px]">
        {state.message}
      </p>
    );
  }
  return null;
}

/**
 * Moving an enquiry along, from the detail screen.
 *
 * Narrower than the edit form on purpose — this is the control somebody uses
 * while still on the phone. The lost reason appears the moment Lost is chosen
 * and is required from that moment, the same rule the form and the database
 * both hold.
 */
export function StatusControl({ enquiry }: { enquiry: EnquiryRow }) {
  const [state, formAction] = useActionState(setEnquiryStatusAction, initialState);
  const [status, setStatus] = useState<string>(enquiry.status);
  const isLost = status === "Lost";
  const unchanged = status === enquiry.status;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={enquiry.id} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="text-muted-foreground block text-xs">Status</span>
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`${fieldClass} w-44`}
          >
            {enquiryStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className={unchanged ? "pointer-events-none opacity-50" : ""}>
          <Submit label="Change status" />
        </div>
      </div>

      {isLost ? (
        <div className="border-overdue/40 max-w-md space-y-3 rounded-lg border p-3">
          <label className="block">
            <span className="text-[13px] font-medium">Why was it lost?</span>
            <select
              name="lostReason"
              required
              defaultValue={enquiry.lostReason ?? ""}
              className={`${fieldClass} mt-1.5`}
            >
              <option value="">Choose a reason…</option>
              {enquiryLostReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[13px] font-medium">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </span>
            <textarea
              name="lostNotes"
              rows={2}
              maxLength={1000}
              defaultValue={enquiry.lostNotes ?? ""}
              className="border-input bg-background mt-1.5 w-full rounded-md border px-3 py-2 text-[13px]"
            />
          </label>
        </div>
      ) : null}

      <Feedback state={state} />
    </form>
  );
}

/**
 * Handing an enquiry to somebody — ADMIN and OWNER only (K15).
 *
 * THIS IS THE ONLY WRITE AN OWNER HAS ON THIS SCREEN, and the only one he has
 * in the module. Every other control here is rendered behind `canWrite`, which
 * `enquiry: "read"` denies him. The action posts one field and the audit
 * wrapper accepts nothing else from an OWNER, so the narrowness is enforced
 * twice and displayed once.
 */
export function AssignOwner({
  enquiry,
  owners,
}: {
  enquiry: EnquiryRow;
  owners: OwnerOption[];
}) {
  const [state, formAction] = useActionState(assignEnquiryOwnerAction, initialState);

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={enquiry.id} />
        <label className="space-y-1">
          <span className="text-muted-foreground block text-xs">Who chases it</span>
          <select
            name="ownerUserId"
            defaultValue={enquiry.ownerUserId}
            className={`${fieldClass} w-64`}
          >
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <Submit label="Reassign" variant="outline" />
      </form>
      <Feedback state={state} />
    </div>
  );
}

/**
 * The purchase order link — A PROMPT, NEVER A GATE.
 *
 * Marking an enquiry Won does not require a PO and must not: a repeat
 * customer's order arrives with no enquiry behind it, and PO capture stays
 * exactly as it is — no new required field, no changed validation. The link is
 * written from this side onto `purchase_order.enquiry_id`, which is nullable
 * and always was.
 */
export function PurchaseOrderLink({
  enquiry,
  options,
}: {
  enquiry: EnquiryRow;
  options: { id: string; internalNo: string; poDate: string }[];
}) {
  const [linkState, linkAction] = useActionState(linkPurchaseOrderAction, initialState);
  const [unlinkState, unlinkAction] = useActionState(unlinkPurchaseOrderAction, initialState);

  if (enquiry.purchaseOrderId) {
    return (
      <div className="space-y-2">
        <p className="text-[13px]">
          Linked to{" "}
          <a
            href={`/purchase-orders/${enquiry.purchaseOrderId}`}
            className="text-primary tabular-nums hover:underline"
          >
            {enquiry.poInternalNo}
          </a>
          .
        </p>
        <form action={unlinkAction}>
          <input type="hidden" name="id" value={enquiry.id} />
          <input type="hidden" name="purchaseOrderId" value={enquiry.purchaseOrderId} />
          <Submit label="Unlink" variant="outline" />
        </form>
        <Feedback state={unlinkState} />
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <p className="text-muted-foreground text-[13px]">
        No unlinked purchase orders for this client yet. Capture the PO as normal — nothing
        about that form changes — and come back here to link it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <form action={linkAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={enquiry.id} />
        <label className="space-y-1">
          <span className="text-muted-foreground block text-xs">Purchase order</span>
          <select name="purchaseOrderId" required className={`${fieldClass} w-64`}>
            <option value="">Choose a PO…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.internalNo} · {formatCommittedDate(p.poDate)}
              </option>
            ))}
          </select>
        </label>
        <Submit label="Link PO" variant="outline" />
      </form>
      <p className="text-muted-foreground text-[12px]">
        Optional. An enquiry can be Won without one, and a PO can exist without an enquiry.
      </p>
      <Feedback state={linkState} />
    </div>
  );
}

/**
 * Removal, for an enquiry entered against the wrong client or duplicated.
 *
 * NOT for one that came to nothing — that is what Dropped is for, and deleting
 * a lost enquiry puts a hole in the funnel the register exists to measure. Soft
 * delete either way (non-negotiable 7).
 */
export function RemoveEnquiry({ enquiry }: { enquiry: EnquiryRow }) {
  const router = useRouter();
  const [state, formAction] = useActionState(removeEnquiryAction, initialState);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-muted-foreground hover:text-overdue text-[13px]"
      >
        Remove this enquiry
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px]">
        Remove {enquiry.enquiryNo}? Use this only if it was entered by mistake. If the job
        simply did not happen, set the status to <strong>Dropped</strong> instead — a deleted
        enquiry is a hole in the funnel.
      </p>
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="id" value={enquiry.id} />
        <Submit label="Remove" variant="destructive" />
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  );
}
