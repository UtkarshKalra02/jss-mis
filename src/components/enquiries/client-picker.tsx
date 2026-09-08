"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { buildClientIndex, matchClient, type ClientMatch } from "@/modules/imports/match";
import type { ClientOption } from "@/modules/designs/queries";

const fieldClass =
  "border-input bg-background mt-1.5 h-9 w-full rounded-md border px-2 text-[13px] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * Who the enquiry came from — TYPED, not chosen from a list.
 *
 * An enquiry is the one thing in this system that routinely arrives from
 * somebody who is not a client yet. A walk-in, an IndiaMART lead, a referral
 * from an architect: none of them are in the client master, and a dropdown of
 * existing clients cannot express any of them. The build spec asked for this
 * and the first cut shipped a dropdown anyway.
 *
 * The matching is the importer's, reused rather than reimplemented (F31/F32):
 * names are compared with legal suffixes stripped and whitespace and case
 * ignored, so "NATUREEXPERT AYURVEDIC PVT LTD" and "Natureexpert Ayurvedic"
 * are the same customer. What that buys is the thing a free-text field
 * otherwise destroys — one customer, one row, however it was typed on the day.
 *
 * FOUR OUTCOMES, and the difference between them matters:
 *
 *   matched   — an exact match after normalising. Used silently; there is no
 *               question to ask.
 *   review    — resembles one or more existing clients. A PERSON decides, and
 *               the alternatives are named. Never guessed.
 *   ambiguous — two existing clients normalise to the same thing. Creating a
 *               third would make it worse, so the only way out is choosing.
 *   create    — nothing resembles it. Says plainly that a client will be made.
 *
 * The browser's copy of the client list can be stale, so this is a
 * convenience: the action re-runs the same matching server-side against live
 * rows before writing anything.
 */
export function ClientPicker({
  clients,
  defaultClientId,
  defaultName,
}: {
  clients: ClientOption[];
  /** Set when editing an enquiry that already points at a client. */
  defaultClientId?: string;
  defaultName?: string;
}) {
  const index = useMemo(
    () => buildClientIndex(clients.map((c) => ({ id: c.id, code: c.code, name: c.name }))),
    [clients],
  );

  const existing = defaultClientId ? clients.find((c) => c.id === defaultClientId) : undefined;

  const [typed, setTyped] = useState(defaultName ?? existing?.name ?? "");
  /** Set when a person has resolved a review/ambiguous case by choosing. */
  const [chosenId, setChosenId] = useState<string | null>(defaultClientId ?? null);

  const match: ClientMatch | null = typed.trim() ? matchClient(typed, index) : null;

  // A choice survives only while the text still stands for it — retyping the
  // name means the question is open again.
  const chosen = chosenId ? clients.find((c) => c.id === chosenId) : undefined;
  const chosenStillValid =
    chosen && (match?.kind === "matched" ? match.client.id === chosen.id : true);

  const resolvedId =
    match?.kind === "matched"
      ? match.client.id
      : chosenStillValid
        ? chosen!.id
        : null;

  const willCreate = Boolean(typed.trim()) && resolvedId === null && match?.kind === "create";

  return (
    <div className="block">
      <label className="block">
        <span className="text-[13px] font-medium">Client</span>
        <input
          name="clientName"
          required
          autoComplete="off"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setChosenId(null);
          }}
          placeholder="Type the name, or a client code"
          className={cn(fieldClass, willCreate && "border-at-risk")}
          aria-describedby="client-picker-status"
        />
      </label>

      {/* What the server will do with this, before it does it. */}
      <input type="hidden" name="clientId" value={resolvedId ?? ""} />

      <div id="client-picker-status" className="mt-1.5 text-[12px]" role="status">
        {!typed.trim() ? (
          <span className="text-muted-foreground">
            Anyone can send an enquiry. If they are not a client yet, one will be created.
          </span>
        ) : resolvedId && (match?.kind === "matched" || chosenStillValid) ? (
          <span className="text-on-time">
            Existing client ·{" "}
            {match?.kind === "matched"
              ? `${match.client.code} — ${match.client.name}`
              : `${chosen!.code} — ${chosen!.name}`}
          </span>
        ) : match?.kind === "review" || match?.kind === "ambiguous" ? (
          <div className="space-y-1.5">
            <p className="text-at-risk">
              {match.kind === "ambiguous"
                ? "Two existing clients have names this close. Choose which one — creating a third would make it worse."
                : "This resembles a client we already have. Choose one, or say it is new."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {match.candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setChosenId(c.id);
                    setTyped(c.name);
                  }}
                  className="border-input hover:bg-muted rounded-md border px-2 py-1 text-[12px]"
                >
                  {c.code} — {c.name}
                </button>
              ))}
              {/* Absent for `ambiguous` on purpose: when two existing clients
                  already collide, adding a third is never the right answer. */}
              {match.kind === "review" ? (
                <span className="text-muted-foreground self-center">
                  or leave the name as typed to create a new client
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="text-at-risk">
            No client matches “{typed.trim()}”. Saving will create one, with a generated
            code and nothing else filled in.
          </span>
        )}
      </div>
    </div>
  );
}
