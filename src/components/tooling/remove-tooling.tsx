"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { removeToolingAction, type FormState } from "@/modules/tooling/actions";

const initialState: FormState = { ok: false, error: null };

/**
 * Removes a tool from the register.
 *
 * Deliberately worded to steer away from itself. A tool that is broken or gone
 * is `Scrapped` or `Lost` — those are facts about the metal and belong in the
 * record. Removal says the ROW should never have been typed, which is a much
 * rarer thing, and it takes the row out of every screen.
 *
 * Redirects on success, because the page it was removed from no longer resolves
 * (G11).
 */
export function RemoveToolingCard({ toolNo, toolId }: { toolNo: string; toolId: string }) {
  const [state, formAction] = useActionState(removeToolingAction, initialState);

  return (
    <section className="border-overdue/30 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Remove from the register</h2>
      <p className="text-muted-foreground mt-1 text-[13px]">
        Only for a record typed by mistake. If the tool is broken or missing, set its
        condition to Scrapped or its status to Lost instead — that is a fact worth keeping,
        and removing the row loses it.
      </p>

      <form
        action={formAction}
        className="mt-3"
        onSubmit={(e) => {
          if (!confirm(`Remove ${toolNo} from the register?`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={toolId} />
        <RemoveButton />
        {state.error ? (
          <p role="alert" className="text-overdue mt-2 text-[13px]">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="destructive" disabled={pending}>
      {pending ? "Working…" : "Remove"}
    </Button>
  );
}
