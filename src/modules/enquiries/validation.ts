import { z } from "zod";

import { enquiryLostReasonEnum, enquiryStatusEnum } from "@/db/schema";

/**
 * Enquiry input validation.
 *
 * The status and lost-reason lists are read off the Postgres enums rather than
 * retyped here, which is non-negotiable 5 applied to a form: there is one
 * definition of what an enquiry's status may be, and it is the database's.
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.");

/**
 * A field the form may not have rendered at all.
 *
 * `FormData.get()` returns **null** for an absent field, and zod's `.optional()`
 * permits `undefined` — not null. The two are not interchangeable at this
 * boundary, and getting it wrong is silent in the worst way: the schema refuses
 * the whole payload against a field the person never saw.
 *
 * That is not hypothetical here. `lostReason` and `lostNotes` are rendered only
 * when the status is Lost, so on every other status they are absent — which is
 * exactly the shape that broke every delegation status change until it was
 * found. Same fix, same reason.
 */
function absentOrBlank<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === null || v === "" ? undefined : v), inner.optional());
}

export const enquiryStatuses = enquiryStatusEnum.enumValues;
export const enquiryLostReasons = enquiryLostReasonEnum.enumValues;

export type EnquiryStatus = (typeof enquiryStatuses)[number];
export type EnquiryLostReason = (typeof enquiryLostReasons)[number];

/** Statuses that close an enquiry, and therefore stamp `closed_at`. */
export const TERMINAL_STATUSES: readonly EnquiryStatus[] = ["Won", "Lost", "Dropped"];

const baseEnquiry = z.object({
  /**
   * EITHER an existing client, OR a name to resolve against the master.
   *
   * An enquiry routinely arrives from somebody who is not a client yet — a
   * walk-in, an IndiaMART lead, a referral — so the form types a name rather
   * than picking from a list. `clientId` is filled in by the picker when the
   * name resolved to an existing client in the browser; `clientName` is always
   * sent, and the action re-resolves it against live rows because the
   * browser's copy of the client list can be stale.
   */
  clientId: absentOrBlank(z.uuid()),
  clientName: z
    .string()
    .trim()
    .min(2, "Say who the enquiry came from.")
    .max(200, "That is too long for a client name."),

  enquiryDate: isoDate,

  sourceId: z.uuid({ message: "Say where the enquiry came from." }),

  referredBy: absentOrBlank(z.string().trim().max(200)),

  itemDescription: z
    .string()
    .trim()
    .min(3, "Say what they are asking for.")
    .max(1000, "Keep it short — the detail belongs on the quotation."),

  /**
   * Optional, and deliberately so. A client who rings up asking "what would
   * 5,000 cartons cost" has a quantity; one asking "can you do foiling on
   * this" does not, and refusing to record the second is how enquiries end up
   * being tracked in a notebook instead.
   */
  qty: absentOrBlank(
    z.coerce
      .number()
      .int("Quantity must be a whole number.")
      .positive("Quantity must be more than zero."),
  ),

  /**
   * THE CLIENT'S STATED ASK. It is never copied into `po_item.committed_date`
   * — what a client asks for and what this factory commits to are different
   * numbers, and OTD is measured against the second one (K4).
   */
  clientRequiredDate: absentOrBlank(isoDate),

  ownerUserId: z.uuid({ message: "Somebody has to own this enquiry." }),

  status: z.enum(enquiryStatuses),

  lostReason: absentOrBlank(z.enum(enquiryLostReasons)),
  lostNotes: absentOrBlank(z.string().trim().max(1000)),
});

/**
 * A Lost enquiry must say why.
 *
 * The same rule the `enquiry_lost_reason_required` CHECK enforces in the
 * database. Both exist on purpose: the constraint is what makes it true for a
 * script or a psql session (non-negotiable 4), and this is what makes the
 * refusal land on the right field with a sentence somebody can act on, rather
 * than as a raw constraint name.
 */
function requireLostReason<T extends z.ZodType<{ status: EnquiryStatus; lostReason?: unknown }>>(
  schema: T,
) {
  return schema.refine((v) => v.status !== "Lost" || v.lostReason !== undefined, {
    path: ["lostReason"],
    message: "Say why it was lost — the win rate is the number this register exists to produce.",
  });
}

export const createEnquirySchema = requireLostReason(baseEnquiry);

export const updateEnquirySchema = requireLostReason(
  baseEnquiry.extend({ id: z.uuid() }),
);

/**
 * The status-only change from the detail screen.
 *
 * Narrower than the full form on purpose: moving an enquiry to Won is a thing
 * somebody does in one click while on the phone, and making that path capable
 * of rewriting the client or the quantity would mean a stale open tab could
 * quietly revert them.
 */
export const statusChangeSchema = requireLostReason(
  z.object({
    id: z.uuid(),
    status: z.enum(enquiryStatuses),
    lostReason: absentOrBlank(z.enum(enquiryLostReasons)),
    lostNotes: absentOrBlank(z.string().trim().max(1000)),
  }),
);

export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;
export type UpdateEnquiryInput = z.infer<typeof updateEnquirySchema>;
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

/**
 * Reads an enquiry out of a posted form.
 *
 * Lives here rather than in the action so the FormData contract can be tested
 * with a real FormData — the only way the null-versus-undefined trap above is
 * ever going to be caught, because a hand-written object is what the author
 * already believes the form sends.
 */
export function parseEnquiryForm(form: FormData) {
  return {
    clientId: form.get("clientId"),
    clientName: form.get("clientName"),
    enquiryDate: form.get("enquiryDate"),
    sourceId: form.get("sourceId"),
    referredBy: form.get("referredBy"),
    itemDescription: form.get("itemDescription"),
    qty: form.get("qty"),
    clientRequiredDate: form.get("clientRequiredDate"),
    ownerUserId: form.get("ownerUserId"),
    status: form.get("status"),
    lostReason: form.get("lostReason"),
    lostNotes: form.get("lostNotes"),
  };
}
