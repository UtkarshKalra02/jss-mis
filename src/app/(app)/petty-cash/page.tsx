import type { Metadata } from "next";
import Link from "next/link";

import { requireAccess } from "@/auth/guard";
import { can } from "@/auth/roles";
import { AddEntryForm } from "@/components/petty-cash/add-entry-form";
import { RestoreEntry, VoidEntry } from "@/components/petty-cash/entry-actions";
import { formatDate, formatINRPrecise } from "@/lib/format";
import { addDaysISO, todayIST } from "@/lib/dates";
import {
  activeHeads,
  daySheet,
  monthByHead,
  monthTopUps,
} from "@/modules/petty-cash/queries";
import { sheetDateSchema } from "@/modules/petty-cash/validation";

export const metadata: Metadata = { title: "Petty cash · JSS MIS" };

/**
 * Petty cash — the office tin, one day at a time (section CC).
 *
 * WHAT THIS SCREEN IS. A daily sheet: what was in the tin at the start of the
 * day, every movement that day, and what should be in it now. Utkarsh's choice
 * on 20 Nov 2026, over a running passbook — a tin is counted against a day, not
 * scrolled.
 *
 * WHO REACHES IT. Three roles have the resource at all (ACCOUNTS, OWNER,
 * ADMIN); the other five have no sidebar entry and get /forbidden on the URL,
 * because `NAV` and `requireAccess` read the same matrix. Of the three, ADMIN
 * is "read": he audits the tin and does not post to it (CC3), so the form and
 * the void buttons are not rendered for him at all. That is not the security
 * boundary — the action re-checks and the audit wrapper re-checks after that —
 * it is so the screen does not offer what the server will refuse.
 *
 * THE BALANCE IS NEVER STORED. Opening and closing come from
 * `petty_cash_balance_on()`, which is the one definition of what is in the tin
 * (migration 0052). The day's in and out totals are summed from the rows this
 * page is showing, so the figures at the bottom always add up the rows above
 * them — the property somebody checking with a calculator needs.
 */
export default async function PettyCashPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const user = await requireAccess("petty_cash");
  const { d } = await searchParams;

  const today = todayIST();

  /*
   * A bad or future date in the query string falls back to today rather than
   * erroring. The URL is a thing people edit and share; a 500 on `?d=yesterday`
   * is a worse answer than today's sheet.
   */
  const parsed = sheetDateSchema.safeParse(d);
  const date = parsed.success && parsed.data <= today ? parsed.data : today;

  const monthStart = `${date.slice(0, 7)}-01`;

  const [sheet, heads, byHead, topUps] = await Promise.all([
    daySheet(date),
    activeHeads(),
    monthByHead(monthStart),
    monthTopUps(monthStart),
  ]);

  const mayWrite = can(user.role, "petty_cash", "write");

  /*
   * Both sides of the month, each summed from the rows shown beside it. Out
   * comes from the by-head view; In from the top-up list, because a top-up has
   * no head and so no row in that view — which is exactly why the month block
   * showed only spending until 23 Nov 2026.
   */
  const monthOut = byHead.reduce((sum, h) => sum + Number(h.spent), 0);
  const monthIn = topUps.reduce((sum, t) => sum + Number(t.amount), 0);
  const monthNet = monthIn - monthOut;

  const prev = addDaysISO(date, -1);
  const next = addDaysISO(date, 1);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">Petty cash</h1>
        <div className="flex items-center gap-2 text-[13px]">
          <Link href={`/petty-cash?d=${prev}`} className="hover:underline">
            ← {formatDate(prev)}
          </Link>
          {date < today ? (
            <>
              <span className="text-muted-foreground">·</span>
              <Link href={`/petty-cash?d=${next}`} className="hover:underline">
                {formatDate(next)} →
              </Link>
              <span className="text-muted-foreground">·</span>
              <Link href="/petty-cash" className="hover:underline">
                Today
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <p className="text-muted-foreground mt-1 text-[13px]">
        The office tin on <span className="font-medium">{formatDate(date)}</span>. Cash only
        — bills, invoices and anything with GST on it stay in Busy.
        {mayWrite ? null : " You can see this sheet; adding and voiding entries is Pradeep's and Amit Sir's."}
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* The day's arithmetic, which is the whole point of the screen        */}
      {/* ------------------------------------------------------------------ */}
      <dl className="bg-muted/40 mt-4 grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground text-xs">Opening</dt>
          <dd className="text-[15px] tabular-nums">{formatINRPrecise(sheet.openingBalance)}</dd>
          <p className="text-muted-foreground text-[11px]">yesterday&rsquo;s closing</p>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">In</dt>
          <dd className="text-on-time text-[15px] tabular-nums">
            {formatINRPrecise(sheet.cashIn)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Out</dt>
          <dd className="text-overdue text-[15px] tabular-nums">
            {formatINRPrecise(sheet.cashOut)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Closing</dt>
          <dd
            className={`text-[15px] font-medium tabular-nums ${
              sheet.overdrawn ? "text-overdue" : ""
            }`}
          >
            {formatINRPrecise(sheet.closingBalance)}
          </dd>
          <p className="text-muted-foreground text-[11px]">should be in the tin</p>
        </div>
      </dl>

      {/*
        The tin cannot hold less than nothing, so this means an entry is
        missing — almost always a top-up nobody wrote down. Said, never
        blocked: see migration 0052's header for why blocking is not possible
        without being wrong in a different way.
      */}
      {sheet.overdrawn ? (
        <p role="alert" className="text-overdue mt-3 text-[13px]">
          The book says the tin is overdrawn. That cannot be true, so an entry is missing —
          usually a top-up that was handed over and not written down.
        </p>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* The day's entries                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="mt-8">
        <h2 className="text-sm font-medium">
          {sheet.live.length === 0
            ? "Nothing recorded on this day"
            : `${sheet.live.length} ${sheet.live.length === 1 ? "entry" : "entries"}`}
        </h2>

        {sheet.live.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-[13px]">
            No cash moved, or nobody has written it up yet. Entries are usually typed the
            next morning, so yesterday&rsquo;s sheet is the one that fills in.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="py-2 pr-3 font-medium">Head</th>
                  <th className="py-2 pr-3 font-medium">Paid to / from</th>
                  <th className="py-2 pr-3 font-medium">What for</th>
                  <th className="py-2 pr-3 text-right font-medium">In</th>
                  <th className="py-2 pr-3 text-right font-medium">Out</th>
                  <th className="py-2 pr-3 font-medium">By</th>
                  {mayWrite ? <th className="py-2 font-medium" /> : null}
                </tr>
              </thead>
              <tbody>
                {sheet.live.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {e.headName ?? <span className="text-muted-foreground">top-up</span>}
                    </td>
                    <td className="py-2 pr-3">{e.party ?? "—"}</td>
                    <td className="py-2 pr-3">{e.purpose}</td>
                    <td className="text-on-time py-2 pr-3 text-right tabular-nums">
                      {e.direction === "In" ? formatINRPrecise(e.amount) : ""}
                    </td>
                    <td className="text-overdue py-2 pr-3 text-right tabular-nums">
                      {e.direction === "Out" ? formatINRPrecise(e.amount) : ""}
                    </td>
                    <td className="text-muted-foreground py-2 pr-3">
                      {e.recordedByName ?? "—"}
                    </td>
                    {mayWrite ? (
                      <td className="py-2">
                        <VoidEntry id={e.id} amount={e.amount} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Voided entries — shown, because a cash book that hides its          */}
      {/* corrections is the thing a cash book exists not to be               */}
      {/* ------------------------------------------------------------------ */}
      {sheet.voided.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-muted-foreground text-sm font-medium">
            Voided on this day ({sheet.voided.length})
          </h2>
          <p className="text-muted-foreground mt-1 text-[12px]">
            Out of the balance, still on the record. Nothing is ever deleted.
          </p>
          <ul className="mt-2 space-y-1.5">
            {sheet.voided.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-muted-foreground line-through">
                  {e.direction === "In" ? "In" : "Out"} {formatINRPrecise(e.amount)}
                  {e.headName ? ` · ${e.headName}` : ""} · {e.purpose}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  voided by {e.voidedByName ?? "—"}
                </span>
                {mayWrite ? <RestoreEntry id={e.id} amount={e.amount} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Add an entry — only for the two roles that keep the tin             */}
      {/* ------------------------------------------------------------------ */}
      {mayWrite ? (
        <section className="mt-8 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Add an entry</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-[13px]">
            Dated {formatDate(date)} by default, because this is that day&rsquo;s sheet.
            Change the date if the cash moved on another day — never a future one.
          </p>
          <AddEntryForm heads={heads} defaultDate={date} maxDate={today} />
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* The month, both ways round. Out by head — the reason the heads are   */}
      {/* a fixed list — and In as the handovers it actually was.              */}
      {/* ------------------------------------------------------------------ */}
      <section className="mt-8">
        <h2 className="text-sm font-medium">
          {new Date(`${monthStart}T00:00:00`).toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          })}{" "}
          so far
        </h2>

        <div className="mt-3 grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {/*
            Money in. Listed rather than totalled: a top-up is a specific
            handover from a specific person, and a bare figure cannot be checked
            against anything. The date links to that day's sheet, which is where
            the rest of the entry is.
          */}
          <div>
            <h3 className="text-muted-foreground text-xs">Cash in — top-ups</h3>
            {topUps.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-[13px]">
                Nothing has gone into the tin this month.
              </p>
            ) : (
              <table className="mt-2 w-full text-[13px]">
                <tbody>
                  {topUps.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="text-muted-foreground py-2 pr-3 text-xs whitespace-nowrap">
                        <Link href={`/petty-cash?d=${t.entryDate}`} className="hover:underline">
                          {formatDate(t.entryDate)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{t.party ?? t.purpose}</td>
                      <td className="text-on-time py-2 text-right tabular-nums">
                        {formatINRPrecise(t.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-2 pr-3" colSpan={2}>
                      Total in
                    </td>
                    <td className="text-on-time py-2 text-right tabular-nums">
                      {formatINRPrecise(monthIn)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Money out, by head. */}
          <div>
            <h3 className="text-muted-foreground text-xs">Cash out — by head</h3>
            {byHead.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-[13px]">
                Nothing spent out of the tin this month.
              </p>
            ) : (
              <table className="mt-2 w-full text-[13px]">
                <tbody>
                  {byHead.map((h) => (
                    <tr key={h.headId} className="border-b last:border-0">
                      <td className="py-2 pr-3">{h.headName}</td>
                      <td className="text-muted-foreground py-2 pr-3 text-right text-xs tabular-nums">
                        {h.entries}
                      </td>
                      <td className="text-overdue py-2 text-right tabular-nums">
                        {formatINRPrecise(h.spent)}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-2 pr-3">Total out</td>
                    <td />
                    <td className="text-overdue py-2 text-right tabular-nums">
                      {formatINRPrecise(monthOut)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/*
          In minus out for the month. NOT a balance: the tin carried something
          over from last month, and what is in it now is the closing figure at
          the top of this page, which comes from petty_cash_balance_on(). This
          line answers a narrower question — did the month put more in than it
          took out.
        */}
        <p className="text-muted-foreground mt-4 text-[13px]">
          This month the tin took in{" "}
          <span className="text-foreground tabular-nums">{formatINRPrecise(monthIn)}</span>{" "}
          and paid out{" "}
          <span className="text-foreground tabular-nums">{formatINRPrecise(monthOut)}</span>,
          {monthNet === 0 ? (
            "leaving it exactly where it started"
          ) : (
            <>
              leaving it{" "}
              <span className="text-foreground tabular-nums">
                {formatINRPrecise(Math.abs(monthNet))}
              </span>{" "}
              {monthNet < 0 ? "lower" : "higher"} than it started
            </>
          )}
          . A top-up has no head, so it is listed on the left rather than counted as
          spending.
        </p>
      </section>
    </div>
  );
}
