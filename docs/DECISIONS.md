# Decisions

Questions raised against [`JSS_MIS_v1_SPEC.md`](JSS_MIS_v1_SPEC.md) and how they were
resolved. The spec is the book of record for *what* the system does; this file records
*why* the implementation looks the way it does where the spec was silent, ambiguous, or
self-contradictory.

Codes (A1, B4, C8…) are referenced from code comments. Keep them stable.

---

## A. Setup

**A1 — Neon.** Project exists. `DATABASE_URL` (pooled) is used by the app;
`DATABASE_URL_UNPOOLED` (direct) by drizzle-kit. Migrations need a stable session that a
pooler cannot guarantee.

**A2 — Stage target hours are placeholders.** The seeded `target_hours` come from an
example workbook and were **never measured on the factory floor**, yet they feed the WIP
ageing calculation. Two consequences, both required: the seed migration says so in a
comment, and `stage.target_hours_verified` stays `false` until a human edits the value,
which the Admin screen surfaces as "unverified". A comment alone is not enough — the
people reading the screen are not the people reading the migration.

**A3 — Client master access.** ADMIN creates, edits, deactivates. ORDER_DESK, PLANNER,
and ACCOUNTS get read and search (Punit cannot enter a PO without picking a client).
OWNER and FLOOR get nothing.

**A4 — User bootstrapping.** Users are seeded with **no usable password**
(`password_hash` null — the account exists but cannot authenticate). Passwords are set
one at a time via a CLI command. Passwords are never written into a config or seed file:
a file containing passwords is a file that can be committed or copied, and a temporary
password that is never written down cannot leak.

---

## B. Contradictions in the spec

**B1 — Section 2's role table contradicts section 6's screen headers.** Section 6 wins
in all three cases:

| Screen | Resolution |
|---|---|
| 6.4 Item Tracker | FLOOR gets read-only access. Ajay looking up an item on his phone is exactly the "stop asking people" use case section 6.4 exists for. |
| 6.8 Dispatch | ACCOUNTS gets it, alongside PLANNER. |
| 6.10 Receipts & AR | OWNER gets read-only access. |

Reports (6.11, no role stated in the spec) go to ADMIN, OWNER, ACCOUNTS.

The resulting matrix lives in `src/auth/roles.ts` and is read by **both** the sidebar and
the server-side guards. Two copies is how navigation and enforcement drift apart.

**B2 — OWNER is globally deny-write.** Enforced as a hard check inside the audit wrapper,
not by hiding navigation. Since every write goes through the wrapper (non-negotiable 3),
there is no route by which a forgotten guard on a future screen could let an OWNER write.

**B3 — Two different definitions of "at risk".** They are two different signals and both
are kept:

- **Item at risk** — committed date within N days and not yet READY (section 6.1). Drives
  the dashboard. N is configurable in `app_setting`, default 3.
- **Stage overrun** — an item has sat in a stage longer than that stage's
  `target_hours` (section 4.1). Drives `v_wip_ageing`.

**B4 — `stage.applies_to` describes the JOB, not the client.** The spec used New/Repeat
for both `client_type` and `applies_to`, but a long-standing repeat client still places
genuinely new jobs, and those jobs do need ENQUIRY and COSTING. Added
`po_item.job_type`, which the spec did not have. `client.client_type` is retained but is
descriptive/reporting only and drives nothing.

**B5 — `purchase_order.status` and `po_item.status` are derived but stored.** This looks
like a violation of non-negotiables 1 and 2, and the distinction matters:

- `current_stage` and `pending_qty` are **never** stored. They are always computed.
- These two status columns **are** stored, because they are filtered and indexed
  constantly, and because `Cancelled` is a human decision that cannot be derived from
  dispatch quantities at all.

The safeguard is that only the recompute function and the explicit Cancel action may
write them. No form ever does.

---

## C. Schema decisions

**C1 — `design.processes text[]` became a `design_process` junction table.** An array
column cannot carry a foreign key, so a typo like `'LAMINATON'` would sit undetected
until a report quietly under-counted. Non-negotiable 4 requires FK enforcement at the
database. As a junction table each row is checked against `stage.code`, and "which
designs need foiling?" becomes an ordinary join.

**C2 — `stage_event` references `stage.code` (text), not `stage.id`.** Stage events are
read directly when debugging derived-stage logic, and `'PRINTING'` is legible where a
uuid is not. The cost is that **stage codes are immutable** — the Admin screen allows
editing name, colour, target hours, sequence, and the optional flag, but never the code.
Changing a code would rewrite history.

Note this forces `stage.code` to carry a **full** unique constraint rather than the
partial one used elsewhere: a foreign key can only target a full UNIQUE. Stages are
configuration and are deactivated rather than deleted, so nothing is lost.

**C3 — Postgres enums for fixed lists; `stage` stays a table.** Anything that varies by
factory process is data; anything that varies only by code change is an enum. Adding an
enum value later needs a migration, which is intentional friction — a new order status
is a decision, not a typo. `committed_date_basis` was promoted from the spec's free text
to an enum on the same reasoning.

**C4 — SYSTEM user.** Nightly recomputes, seeds, and migration scripts have no logged-in
user but still write audit rows. They act as a seeded SYSTEM user (inactive, no password
hash, cannot log in). Migration and import scripts **do** write audit rows — otherwise
the first real audit trail has a hole in it exactly where the historical data arrived.

**C5 — Partial unique indexes.** All natural keys are `UNIQUE ... WHERE deleted_at IS
NULL`. Without the predicate, deactivating client `NAT` would permanently burn the code
`NAT`. Consequence: a deleted and a live row may share a code, which is the intent.

**C6 — Two tables are exempt from the standard column set.** `stage_event` is append-only
(no `updated_at`/`updated_by`/`deleted_at`, since none of those operations are
permitted). `audit_log` is the audit trail itself — auditing it is circular, and a
soft-deletable audit log is not an audit log. Both are enforced by triggers that raise on
UPDATE and DELETE.

**C7 — Numbering uses the Indian financial year, April to March.** `PO-2025-0001` is the
first PO of April 2025 through March 2026. `DSN` is the exception and is not year-scoped
(`fy_start = 0`), because a die or plate design outlives any financial year. Numbers are
allocated with `SELECT ... FOR UPDATE` inside the same transaction as the row they
number, so simultaneous PO entry cannot collide.

**C8 — Cross-entity integrity needs triggers.** Two pairs of foreign keys are
individually valid while jointly nonsense, and both are now blocked at the database:

- a `dispatch_line` whose `po_item` belongs to a different client than its `dispatch`
- an `invoice_line` whose `dispatch_line` belongs to a different client than its `invoice`

**C9 — All six views ship in Phase 1**, even though their screens do not. Non-negotiables
1 and 2 are *implemented* by `v_po_item_status`; until it exists, "derived, never stored"
is a promise rather than a property of the database.

**C10 — All date-boundary arithmetic casts to `Asia/Kolkata`.** A dispatch entered at 9pm
IST is 15:30 UTC the same day, but naive UTC comparison can roll it to the wrong date and
silently corrupt OTD — the one number this system exists to produce. The rule is repeated
at the top of the views migration.

---

## D. Deferred

- **File storage** (`purchase_order.file_url`, `design.artwork_url`) — columns exist and
  hold plain text. Vercel Blob, decided in Phase 2.
- **GST is not calculated here.** Busy is the book of record; tax amounts are typed in to
  match what Busy produced, and `invoice_no` is Busy's number, not one this system
  allocates.
- **Testing is deliberately narrow** — Vitest over the audit wrapper and the constraint
  triggers only. Those are the two things that are silently catastrophic when broken. No
  component tests.

---

## E. Decisions forced during the build

**E1 — Next.js pinned to 15.** `create-next-app@latest` installs Next 16. The stack is
fixed at 15, so it was pinned back to 15.5.23. Two artifacts of the downgrade had to be
corrected: `layout.tsx` used the Next 16 `LayoutProps<>` generic, and `eslint.config.mjs`
used flat-config imports that do not resolve against `eslint-config-next` 15 (bridged
with `FlatCompat` instead).

**E2 — `drizzle-orm/neon-serverless`, not `neon-http`.** The HTTP driver is lower latency
but **cannot do interactive transactions**. The audit wrapper writes the mutation and its
audit row in one transaction, so non-negotiable 3 is only enforceable with the
WebSocket-backed pool. Switching drivers for speed would silently break it.

**E3 — Hard `DELETE` is blocked only on the append-only tables.** `stage_event` and
`audit_log` raise on DELETE. The business tables do not, because the audit wrapper is the
only write path and exposes no hard delete — the application physically cannot issue one.
Leaving raw DELETE available at `psql` is an intentional escape hatch for genuine data
repair, which, being outside the app, is a decision someone has to make consciously.

**E4 — Known npm audit warnings.** `npm audit` reports moderate/high advisories in
`postcss` and `sharp`, both transitive dependencies of Next 15. The only offered fix is
upgrading to Next 16, which the fixed stack forbids. Both are build-time and
image-optimisation concerns rather than request-path issues. Revisit if the stack ever
moves to 16.
