"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClientAction, updateClientAction, type FormState } from "@/modules/clients/actions";

const initialState: FormState = { ok: false, error: null };

type ClientValues = {
  id?: string;
  code?: string;
  name?: string;
  gstin?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  paymentTermsDays?: number;
  creditLimit?: string | null;
  clientType?: string;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Field({
  name,
  label,
  hint,
  ...props
}: {
  name: string;
  label: string;
  hint?: string;
} & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

const selectClass =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

export function ClientForm({
  mode,
  client,
}: {
  mode: "create" | "edit";
  client?: ClientValues;
}) {
  const [state, formAction] = useActionState(
    mode === "create" ? createClientAction : updateClientAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-8">
      {mode === "edit" ? <input type="hidden" name="id" value={client!.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="code"
            label="Code"
            required
            defaultValue={client?.code ?? ""}
            placeholder="NAT"
            autoCapitalize="characters"
            hint="Short internal reference. Letters, numbers and hyphens."
          />
          <Field
            name="name"
            label="Name"
            required
            defaultValue={client?.name ?? ""}
            placeholder="Nature Packaging Pvt Ltd"
          />
          <Field
            name="gstin"
            label="GSTIN"
            defaultValue={client?.gstin ?? ""}
            placeholder="07AABCU9603R1ZM"
            autoCapitalize="characters"
            hint="Optional. 15 characters."
          />
          <div className="space-y-2">
            <Label htmlFor="clientType">Type</Label>
            <select
              id="clientType"
              name="clientType"
              defaultValue={client?.clientType ?? "New"}
              className={selectClass}
            >
              <option value="New">New</option>
              <option value="Repeat">Repeat</option>
            </select>
            <p className="text-muted-foreground text-xs">
              Reporting only. Which stages a job goes through is decided per item, not here.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Address</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="addressLine1" label="Address line 1" defaultValue={client?.addressLine1 ?? ""} />
          <Field name="addressLine2" label="Address line 2" defaultValue={client?.addressLine2 ?? ""} />
          <Field name="city" label="City" defaultValue={client?.city ?? ""} />
          <Field name="state" label="State" defaultValue={client?.state ?? ""} />
          <Field
            name="pincode"
            label="Pincode"
            defaultValue={client?.pincode ?? ""}
            inputMode="numeric"
            placeholder="110020"
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Contact</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="contactName" label="Contact name" defaultValue={client?.contactName ?? ""} />
          <Field
            name="contactPhone"
            label="Phone"
            defaultValue={client?.contactPhone ?? ""}
            inputMode="tel"
          />
          <Field
            name="contactEmail"
            label="Email"
            type="email"
            defaultValue={client?.contactEmail ?? ""}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Commercial</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="paymentTermsDays"
            label="Payment terms (days)"
            type="number"
            min={0}
            max={365}
            defaultValue={client?.paymentTermsDays ?? 30}
            hint="Invoice due date is the invoice date plus this many days."
          />
          <Field
            name="creditLimit"
            label="Credit limit (₹)"
            type="number"
            min={0}
            step="0.01"
            defaultValue={client?.creditLimit ?? ""}
            hint="Leave blank for no limit. Exceeding it warns, never blocks."
          />
        </div>
      </section>

      {/* Section 7: inline validation, never a modal for errors. */}
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

      <Submit label={mode === "create" ? "Add client" : "Save changes"} />
    </form>
  );
}
