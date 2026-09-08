import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { requireAccess } from "@/auth/guard";
import { PrintBar } from "@/components/job-cards/print-button";
import { formatDate, formatQty } from "@/lib/format";
import { getDispatch, listDispatchLines } from "@/modules/dispatches/queries";

export const metadata: Metadata = { title: "Delivery challan · print" };

/**
 * THE PRINTED DELIVERY CHALLAN — the second print surface, and the one J7 said
 * was still owed.
 *
 * J7's rule is "print what is read by somebody who cannot open a screen", and
 * it is why the job card printed first: Ajay reads that at a press. The same
 * rule is what makes this document owed rather than optional — a challan goes
 * out of the building with the goods, and the party's gatekeeper who signs for
 * them has no screen either. Preeti at her desk was never the reader.
 *
 * WHAT THIS IS NOT. It is not a tax invoice and does not try to be: no rates,
 * no amounts, no tax. The rates are on the dispatch lines and belong to the
 * invoice (Phase 5), and a document carrying money without being an invoice is
 * the kind of thing that gets argued about at a gate. Quantities only.
 *
 * A CHALLAN THAT IS NOT DISPATCHED SAYS SO, LOUDLY. A draft has not left and a
 * cancelled one never did; either printing as an ordinary challan is a piece of
 * paper that claims goods moved when they did not. The status band is
 * unmissable rather than tasteful, deliberately.
 */
export default async function DispatchPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("dispatch");

  const { id } = await params;
  const challan = await getDispatch(id);
  if (!challan) notFound();

  const lines = await listDispatchLines(id);

  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);

  // Every distinct order these goods are against. Usually one; several when a
  // client's delivery pulls items from more than one open PO, which is normal
  // once a PO is delivered across several days.
  const poNumbers = [...new Set(lines.map((l) => l.poInternalNo))];

  const address = [
    challan.clientAddressLine1,
    challan.clientAddressLine2,
    [challan.clientCity, challan.clientState].filter(Boolean).join(", "),
    challan.clientPincode,
  ].filter(Boolean);

  const provisional = challan.status !== "Dispatched";

  return (
    <>
      <PrintBar backHref={`/dispatch/${id}`} backLabel={challan.challanNo} />

      <div className="print-sheet">
        {/* A draft has not left and a cancelled one never did. Paper outlives
            the screen it was printed from, so the sheet has to say which. */}
        {provisional ? (
          <div className="print-box mb-3 border-2 px-3 py-2 text-center">
            <p className="text-[13pt] font-bold tracking-[0.08em] uppercase">
              {challan.status} — not a delivery document
            </p>
            <p className="print-hint mt-0.5">
              {challan.status === "Cancelled"
                ? "This challan was cancelled. These goods did not go out against it."
                : "This challan is still a draft. It consumes no order quantity and nothing has left."}
            </p>
          </div>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Letterhead and document title                                     */}
        {/* ---------------------------------------------------------------- */}
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
          <div className="flex items-start gap-3">
            <Image src="/jss-logo.png" alt="" width={44} height={44} priority />
            <div>
              <h1 className="text-[15pt] leading-tight font-bold tracking-tight">
                JSS THE PRINT ZONE
              </h1>
              {/* The same address the job card carries, for the same reason:
                  the phone, email and ISO line on the reference stationery
                  belong to another company and are not reproduced. */}
              <p className="text-[8pt] leading-snug">
                Plot No. 39, DSIDC, Scheme-1, Okhla Industrial Area, Phase-II,
                <br />
                New Delhi-110020 (India)
              </p>
              <p className="print-label mt-1">
                {/* NOT INVENTED. A challan should carry the consignor's GSTIN
                    and the system does not hold one — writing a plausible
                    number on an outgoing document would be worse than leaving
                    somebody to fill it in. */}
                GSTIN <span className="print-rule" style={{ minWidth: "9rem" }} />
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[13pt] font-bold tracking-[0.06em] uppercase">Delivery Challan</p>
            <p className="text-[13pt] font-bold tabular-nums">{challan.challanNo}</p>
            <p className="print-label mt-1">Date</p>
            <p className="print-value font-medium tabular-nums">
              {formatDate(challan.dispatchDate)}
            </p>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        {/* Consignee and movement                                            */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break mt-3 grid grid-cols-2 gap-4">
          <div className="print-box p-2.5">
            <p className="print-section-title">Consignee</p>
            <p className="print-value mt-1 font-bold">{challan.clientName}</p>
            {address.length > 0 ? (
              <p className="text-[9.5pt] leading-snug">
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </p>
            ) : (
              // An address the master does not hold. A rule to write on beats a
              // blank space, because the gatekeeper needs it either way.
              <p className="mt-1">
                <span className="print-rule" style={{ minWidth: "100%" }} />
                <span className="print-rule mt-1" style={{ minWidth: "100%" }} />
              </p>
            )}
            <p className="print-label mt-1.5">
              GSTIN{" "}
              {challan.clientGstin ? (
                <span className="print-value tabular-nums">{challan.clientGstin}</span>
              ) : (
                <span className="print-rule" style={{ minWidth: "9rem" }} />
              )}
            </p>
          </div>

          <div className="print-box p-2.5">
            <p className="print-section-title">Movement</p>
            <dl className="mt-1 space-y-1">
              <Row label="Vehicle no.">{challan.vehicleNo}</Row>
              <Row label="Transporter">{challan.transporter}</Row>
              <Row label="E-way bill">{challan.ewayBillNo}</Row>
              <Row label={poNumbers.length === 1 ? "Against order" : "Against orders"}>
                {poNumbers.join(", ")}
              </Row>
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* The goods                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-3">
          <table className="w-full border-collapse text-[10pt]">
            <thead>
              <tr>
                <th className="border border-black px-1.5 py-1 text-left font-bold">#</th>
                <th className="border border-black px-1.5 py-1 text-left font-bold">Item</th>
                <th className="border border-black px-1.5 py-1 text-left font-bold">
                  Description
                </th>
                <th className="border border-black px-1.5 py-1 text-left font-bold">Order</th>
                <th className="border border-black px-1.5 py-1 text-right font-bold">
                  Quantity
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.id}>
                  <td className="border border-black px-1.5 py-1 tabular-nums">{i + 1}</td>
                  <td className="border border-black px-1.5 py-1 tabular-nums">
                    {line.itemCode}
                  </td>
                  <td className="border border-black px-1.5 py-1">{line.itemName}</td>
                  <td className="border border-black px-1.5 py-1 tabular-nums">
                    {line.poInternalNo}
                  </td>
                  <td className="border border-black px-1.5 py-1 text-right tabular-nums">
                    {formatQty(line.qty)}
                  </td>
                </tr>
              ))}

              {/* Empty rules to the bottom of a short challan. A form with a
                  ragged half-empty table invites somebody to add a line after
                  it was signed. */}
              {Array.from({ length: Math.max(0, 8 - lines.length) }).map((_, i) => (
                <tr key={`blank-${i}`}>
                  <td className="border border-black px-1.5 py-1">&nbsp;</td>
                  <td className="border border-black px-1.5 py-1" />
                  <td className="border border-black px-1.5 py-1" />
                  <td className="border border-black px-1.5 py-1" />
                  <td className="border border-black px-1.5 py-1" />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="border border-black px-1.5 py-1 text-right font-bold">
                  Total
                </td>
                <td className="border border-black px-1.5 py-1 text-right font-bold tabular-nums">
                  {formatQty(totalQty)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Said plainly, because the alternative is somebody at a gate
              deciding for themselves what this piece of paper is. */}
          <p className="print-hint mt-1">
            Quantities only. This is a delivery challan and not a tax invoice — no rates or
            amounts are stated on it.
          </p>
        </section>

        {challan.remarks ? (
          <section className="print-avoid-break mt-3">
            <p className="print-section-title">Remarks</p>
            <p className="text-[10pt] whitespace-pre-wrap">{challan.remarks}</p>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Signatures                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section className="print-avoid-break mt-6 grid grid-cols-2 gap-8">
          <div>
            <p className="print-hint">
              Received the above goods in good order and condition.
            </p>
            <div className="mt-8 border-t border-black pt-1">
              <p className="print-label">Receiver&apos;s signature, name and date</p>
            </div>
          </div>
          <div className="text-right">
            <p className="print-hint">For JSS The Print Zone</p>
            <div className="mt-8 border-t border-black pt-1">
              <p className="print-label">Authorised signatory</p>
            </div>
          </div>
        </section>

        <p className="print-hint mt-4 border-t border-neutral-400 pt-1">
          {challan.challanNo} · printed from JSS MIS
        </p>
      </div>
    </>
  );
}

/** A labelled value that admits when it has nothing, rather than printing blank. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex gap-2">
      <dt className="print-label w-24 shrink-0 pt-0.5">{label}</dt>
      <dd className="print-value flex-1">
        {empty ? <span className="print-rule" style={{ minWidth: "100%" }} /> : children}
      </dd>
    </div>
  );
}
