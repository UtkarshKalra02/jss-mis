import type { Role } from "@/auth/roles";

/**
 * Who may decide WHO CHASES an enquiry.
 *
 * Raising an enquiry and deciding who chases it are two different acts, and
 * this module exists because they now belong to different people. Anyone at a
 * desk can record what a client asked for — the person who took the call is
 * the person who knows what was said. Handing that enquiry to somebody is an
 * allocation of work, which is Amit's or an admin's.
 *
 * A pure function with no database and no session, for the reason
 * delegation/permissions.ts gives: a rule invented inside an action is a rule
 * that exists in one place and is checked in one code path.
 */

/**
 * ADMIN and OWNER, and nobody else.
 *
 * OWNER IS HERE DELIBERATELY AND IT IS A SECOND EXCEPTION TO B2 (see K15).
 * Amit already delegates tasks under J26 on the reasoning that allocating work
 * is the one thing an owner does that is not "running the business through
 * other people's screens". Saying who chases an enquiry is the same act
 * against a different table, and it is carved out the same way: narrowly, in
 * the audit wrapper, on one field.
 *
 * Everybody else with enquiry write raises enquiries owned by themselves and
 * cannot hand them on. That is not a courtesy — it is what stops the owner
 * field drifting into "whoever edited this last".
 */
export function canAssignEnquiryOwner(role: Role): boolean {
  return role === "ADMIN" || role === "OWNER";
}

/**
 * The owner an enquiry should actually be saved with.
 *
 * DECIDED ON THE SERVER, never taken from the form for somebody who cannot
 * assign. A select that is not rendered is not a permission, and a posted
 * field is a suggestion — the form omits the control for those roles, and this
 * is what makes the omission true.
 *
 * `requested` is what the form sent, `fallback` is what the row should keep:
 * the actor's own id when creating, or the existing owner when editing. So an
 * order-desk edit to an enquiry Amit assigned to somebody else leaves his
 * decision standing rather than quietly reclaiming it.
 */
export function resolveEnquiryOwner(
  role: Role,
  requested: string | undefined,
  fallback: string,
): string {
  if (!canAssignEnquiryOwner(role)) return fallback;
  return requested ?? fallback;
}
