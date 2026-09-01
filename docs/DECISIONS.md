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
  hold plain text. Deferred again at the start of Phase 2; see F5. A pasted Drive URL is
  the Phase 2 answer.
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

Adding `exceljs` in Phase 2 brought one more: a moderate advisory against `uuid` 8.3.2, a
missing buffer bounds check in v3/v5/v6 when a `buf` argument is supplied. It is not
reachable here. `exceljs` imports only `v4` and calls it with no arguments, from a single
file that generates conditional-formatting rule ids
(`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`). Checked rather than assumed, and
worth rechecking if exceljs is ever upgraded.

**E5 — `last_login_at` is not routed through the audit wrapper.** It is session
bookkeeping rather than a business record change, and auditing every sign-in would bury
real changes under noise. The `set-password` CLI *does* write an audit row, because a
credential change is a security event — but it records only that the password changed,
never the hash. An audit log holding password hashes is a second copy of the credential
table with weaker access control.

**E6 — `requireAccess()` is the guard, not `requireUser()`.** Found by testing: a page
that only calls `requireUser()` proves somebody is signed in, not that they are allowed
on that screen, so a FLOOR account reached `/dashboard` by typing the URL even though the
matrix denies it. `src/auth/guard.ts` combines both checks in one call and redirects to
`/forbidden` on failure, so there is no reason for a page to reach for the weaker helper.
Middleware cannot do this job — it runs on the edge and only sees the JWT.

**E7 — Auth.js JWT type augmentation must target `@auth/core/jwt`.** `next-auth/jwt` is
a pure `export * from "@auth/core/jwt"`, so `declare module "next-auth/jwt"` creates a
NEW interface rather than merging with the real one, and the custom fields silently stay
`unknown` at every call site.

**E8 — Guarded pages re-read the account from the database on every request.** Auth.js
does not support database sessions with the credentials provider, so the session is a JWT
and the role and account status inside it are a snapshot frozen for the token's whole
lifetime (eight hours here). Trusting that snapshot means deactivating an account has no
effect until the token expires, and a role demotion leaves the old permissions live for
the rest of the day — both fail open, and neither is visible to whoever made the change.
`requireAccess()` therefore pays one indexed lookup per guarded page to ask who the user
is now. Verified end to end: an already-issued, still-valid session cookie is rejected
immediately after `is_active` is set false.

**E9 — Admin-set passwords are temporary.** When an ADMIN sets a password for somebody
else, `must_change_password` is set and the shell refuses to render until that person
chooses their own. Handing someone a password is unavoidable; leaving it in place is not,
so the password actually in use ends up known only to the person using it. Setting your
own password — from the panel or the CLI — does not set the flag, because being told to
immediately change a password you just chose is pointless friction. The CLI takes
`--force-change` for the case where it is used on someone else's behalf.

**E10 — Lockout guards on user administration.** `/admin/users` is the only way to
administer the system, and a single click can close it to everyone. You cannot
deactivate, delete, or demote yourself, and none of those are permitted against the last
ADMIN **who can actually sign in** — an admin with no password set is not a way back in,
so `activeAdminCount()` requires a password hash. The pages explain why a control is
unavailable rather than showing a dead button, and the server actions re-check
independently, since the page is only the explanation and never the enforcement.

**E11 — Usernames are immutable.** Audit rows and stage events are read by username in
practice, so renaming an account would quietly rewrite who appears to have done past
work. To change one, remove the account and add a new one; the partial unique index
frees the old username for reuse.

**E12 — The grid uses TanStack Table's `/legacy` entrypoint.** v9 ships a new native API
built on atoms, stores, and granular `Subscribe` components. It is more capable, but it is
a much larger mental model and almost every example, tutorial, and answer online is written
against the v8-shaped API — which `/legacy` carries forward on the current major. For a
codebase maintained by one person, matching the documentation that actually exists is worth
more than the newer API's ceiling. The choice is confined to
`src/components/data-table/data-table.tsx`, so migrating later is a change to one file.

**E13 — Only `code` and `name` are required on a client.** A purchase order routinely
arrives before anyone has the GSTIN or the billing address, and a form that refuses to save
without them gets fed placeholder junk that is worse than a blank. Empty fields are stored
as NULL rather than empty strings so "not known yet" stays distinguishable, and an unset
credit limit stays NULL because no limit is not the same as a limit of zero.

**E14 — Stage config saves the whole table at once.** The realistic task is entering
fourteen measured numbers after somebody has timed the floor, not editing one stage in
isolation, so all rows post together and commit in one transaction. The change detection is
extracted into `src/modules/stages/diff.ts` as a pure function so it can be unit tested
without a session: `target_hours` is `numeric(6,2)`, so the database returns `"6.00"` while
the form posts `"6"`, and comparing those as strings would mark every stage changed on every
save and write fourteen meaningless audit rows. Blank and zero are also kept distinct —
blank means no target, zero means the stage should be instantaneous.

**E15 — The "measured" tick can be turned off again.** Editing a target hour ticks it
automatically, since a number a human just typed is no longer the seeded placeholder. But
the box stays editable, because a revised estimate is still an estimate. A2 is about guesses
never presenting themselves as measurements, and that has to work in both directions.

**E16 — The brand indigo IS the section 7 accent.** The JSS mark's darkest colour
(`#3B3288`) is close enough to the "deep indigo" section 7 asks for that they are the same
token rather than two near-identical ones. The cyan and mid-blue exist so the mark renders
correctly and are deliberately not mapped to anything semantic — section 7 permits one
accent, and the logo having three colours is not a licence to colour buttons turquoise.
Dark mode lightens the same hue (`#8279E0`) rather than substituting a different colour.

**E17 — The logo is a redraw, not the original artwork.** `public/jss-logo.svg` was
reconstructed by hand from a raster image, as vectors so it stays crisp at 20px in the
sidebar and in print stylesheets later. It is a close approximation, not the real file.
Every usage points at that one path, so dropping in the genuine vector replaces it
everywhere with no code change.

**E18 — Theme is light / dark / system, not a two-way switch.** "System" is the honest
default for a desktop that follows the OS at dusk, and a plain toggle gives no way back to
it once touched. The toggle is reachable on the login screen too, before sign-in — somebody
on a night shift should not have to authenticate against a white screen first.

---

## F. Phase 2 decisions

Settled 18 Aug 2026, before any Phase 2 code was written, in answer to the ambiguities
raised after reading the shipped Phase 1. The importer requirements these sit alongside
are in [`BACKLOG.md`](BACKLOG.md).

**F1 — `stage_event` writes go through the audit wrapper, via a new `auditedAppend`.**
The wrapper's `AuditableTable` type requires `created_by`/`updated_by`/`deleted_at`, which
`stage_event` deliberately does not have (C6). The effect was that the one table Phase 2
exists to write had no audited write path at all, so non-negotiable 3 and the OWNER
deny-write rule (B2) both had a hole exactly where Phase 2 lands. `auditedAppend` closes
it: insert-only, no update or delete counterpart, same transaction, same OWNER check.
Leaving stage events to write directly and relying on `entered_by` was rejected — that
records who, but nothing records *that a write happened* in the one log that is supposed
to be complete.

The two write paths are mutually exclusive at the type level, and deliberately so:
`AuditableTable` requires `created_by`/`updated_by`/`deleted_at`, `AppendOnlyTable`
requires `entered_by`, and no table satisfies both. A business table therefore cannot be
appended to and a stage event cannot be updated — neither is reachable to write, rather
than merely discouraged in a comment. `tests/audit.test.ts` pins this with a pair of
`@ts-expect-error` directives inside a function that is never called, so `npm run
typecheck` fails the moment either boundary stops holding.

`entered_by` is stamped from the actor rather than accepted from the caller, for the same
reason `auditedInsert` stamps `created_by`: the person the audit row names and the person
the event names must not be able to disagree.

**F2 — Dispatch shows every item with `pending_qty > 0`, not only items at READY.**
Spec 6.8 gates the dispatch screen on `stage = READY`. Applied literally that would hide
precisely the rows Phase 2 needs, because backfilled historical jobs do not arrive at
READY — they arrive already delivered. Items not at READY are shown with a warning badge.
The rule is warn, never block. A gate that is wrong for the current month's real work is
worse than a badge somebody learns to read.

**F3 — Saving a dispatch writes a `DISPATCHED` stage event at the dispatch date.**
`event_at` is the dispatch date, not the moment of typing. `stage_event.event_at` already
means "when it actually happened on the floor" rather than when someone got round to
entering it, and back-dated challans are routine. Using `now()` would compress months of
backfilled history into a single afternoon and make every WIP-ageing and lead-time figure
derived from it meaningless.

**F4 — Stage Update offers stages in one fixed precedence.** Three sources could each
decide which stages apply, so the order between them is fixed rather than left to whoever
writes the query:

1. the design's `design_process` route, when the design has one;
2. otherwise `stage.applies_to` filtered by `po_item.job_type` (B4);
3. `is_optional` narrows within whichever of those applied.

Moving an item *backwards* is allowed, behind a confirmation warning. Rework is real on a
shop floor and a system that cannot express it gets worked around. Backward moves are
logged as ordinary events, because they are ordinary events — `stage_event` is append-only
and a correction has always been an append (C6).

**F5 — File uploads deferred a second time.** `purchase_order.file_url` and
`design.artwork_url` stay plain text columns holding a pasted Drive URL. Vercel Blob is a
new storage dependency, a new failure mode, and a new thing to back up, against a Phase 2
that is already six screens. Deferring costs nothing that is not recoverable: the columns
do not change shape when a real uploader arrives.

**F6 — Cancel ships in Phase 2, for both PO and item.** B5 permits exactly two writers to
`purchase_order.status` and `po_item.status`: the recompute function and an explicit
Cancel action. Building only the recompute half would leave `'Cancelled'` unreachable and
the safeguard untestable.

**F7 — A duplicate `po_no` within a client warns, and does not block.** Historical paper
records repeat and mistype PO numbers, and a hard uniqueness constraint would reject real
data that genuinely exists. The warning is at the form; there is no database constraint,
deliberately.

**F8 — `committed_date` is nullable in the database and required at every human entry
point.** Non-negotiable 6 and the importer requirement in `BACKLOG.md` could not both hold
as written: the column was `not null`, and a historical job copied out of a paper book
genuinely has no commitment attached to it. Recording an invented date would be worse than
recording none, because an invented date is indistinguishable from a real one and would
quietly become part of OTD. The resolution is narrow and has five parts, all of which are
required together:

1. The column becomes nullable.
2. The PO capture form requires it, always. There is no skip button and no exception.
3. The importer is the only path permitted to write null, and only for rows flagged as
   historical.
4. `v_otd` excludes null-committed rows entirely. They must never count as met and never
   count as missed — an item with no commitment cannot be late, and treating it as on time
   would inflate the one number this system exists to produce.
5. Every screen renders a null committed date as "Historical — no commitment recorded",
   never as a blank cell. A blank reads as missing data somebody should go and fill in; the
   whole point is that there is nothing to fill in.

Spec section 10 was amended to match, so the non-negotiable and the schema do not disagree.
This is the only point at which Phase 2 relaxes section 10, and it is written down here
precisely so that it stays the only one.

**F9 — Number allocation does not write an audit row.** Non-negotiable 3 says every write
goes through the audit wrapper, and `number_series` is the one table Phase 2 writes
outside it. The counter bump is bookkeeping rather than a business record change, on the
same reasoning that keeps `last_login_at` out of the wrapper (E5): auditing it would add
two rows of noise to every document created, burying the changes somebody actually needs
to find. Nothing is lost, because the allocated number is a column on the row that
consumed it, and that insert *is* audited — so "which number was issued, to what, by whom"
is still answerable from the log.

The safety property C7 asks for is preserved differently. `allocateNumber` takes a
transaction as a required argument rather than an optional one, so it cannot be called
outside the transaction that creates the row it numbers. If that row fails to insert, the
allocation rolls back with it and the number is not burnt. An OWNER attempting a write
allocates nothing, because the audited insert alongside it throws and takes the whole
transaction down.

**F10 — The financial year comes from the document's own date, not from today.** A PO
dated 28 March 2025 is the 2024-25 financial year's PO whether it is entered that week or
backfilled a year later, and C7 defines the series in terms of the document
("`PO-2025-0001` is the first PO of April 2025 through March 2026"), not in terms of the
typist. Allocation therefore takes the date of the thing being numbered and defaults to
today in IST only when none is given. The consequence is deliberate: the historical import
writes into old financial years' series, so numbers are chronological within a year but
not in creation order — which is correct, and is the behaviour anybody reading
`PO-2024-0007` would assume.

**F11 — The status write lock is a database refusal, not a compile error.** B5 promised
that only the recompute function and the Cancel action may write
`purchase_order.status` and `po_item.status`. Migration 0006 makes that true with a
`BEFORE UPDATE` trigger on both columns, keyed on a transaction-local setting
(`jss.allow_status_write`) that only those two writers turn on. Excluding `status` from
the TypeScript update types was considered and rejected on the same reasoning that put
the dispatch quantity ceiling in a trigger rather than in the application: a rule that
lives only in TypeScript is a rule the import script does not have, and a `psql` session
does not have at all.

`set_config(..., is_local => true)` is used rather than a session-level `SET`, because it
reverts on commit or rollback and is therefore safe behind a connection pooler in
transaction mode — which is exactly what `DATABASE_URL` is. `INSERT` is guarded as well as
`UPDATE`, or the lock could be sidestepped by creating rows that are born `Closed`; the
guard permits the `'Open'` default and nothing else.

The recompute half needs no application call site at all. It runs from `AFTER` triggers on
`dispatch_line`, on `dispatch` (cancelling a whole challan changes every item on it
without touching a single line row), and on `po_item.ordered_qty`. The spec asks for
"derived nightly + on write"; doing the on-write half in the application would mean every
future screen touching a dispatch has to remember to call it, and the screen that forgets
produces a wrong status that looks exactly like a right one.

Both recompute functions read `dispatched_qty` from `v_po_item_status` rather than
re-summing `dispatch_line`. That is measurably slower and worth it: the rules about which
challans consume order quantity then have one definition instead of two that can drift,
and the symptom of drift would be a status column disagreeing with the pending quantity
printed beside it.

`Cancelled` is never derived away, in either function. It is a human decision and dispatch
quantities have no opinion about it.

**F12 — The recompute writes its own audit rows.** It writes `status`, and non-negotiable
3 says every write is audited, so it inserts an `audit_log` row attributed to the SYSTEM
user (C4) inside the same transaction as the change. The `audit_log` schema comment
already anticipated this. Volume is a non-issue because the functions only write when the
computed value actually differs: a nightly sweep across unchanged rows logs nothing, and
an item transitions `Open → Closed` about once in its life.

These rows carry only the `status` field in `before`/`after`, not the whole-row snapshot
that `src/db/audit.ts` writes. The wrapper serialises JavaScript objects and so produces
camelCase keys, while `to_jsonb()` in SQL would produce snake_case ones; a partial object
is visibly a delta and cannot be mistaken for a snapshot in the wrong shape.

**F13 — The quantity ceiling is now enforced from both directions.** Migration 0001 stopped
`SUM(dispatch_line.qty)` exceeding `ordered_qty` by growing the dispatch side. Nothing
stopped the identical violation being reached from the other side — reducing `ordered_qty`
below what had already gone out. That path produces no error anywhere. It produces a
negative `pending_qty`, which surfaces as a minus sign in a column on the Item Tracker and
an item that quietly drops out of every "still owed" filter. Reducing an over-entered
order is legitimate, so the guard blocks only the part that is not: the challans have to
be corrected first, which is where the wrong number actually is.

**F14 — The six views are described to TypeScript, and deliberately not in the schema
barrel.** Until Phase 2 the views existed only in Postgres: correct, tested, and reachable
from `psql` and nowhere else. That is the state most likely to produce a second definition
of `pending_qty`, because a screen author who cannot select from `v_po_item_status` will
rebuild the arithmetic in a query instead — and the moment two definitions exist, one of
them is wrong (non-negotiable 2).

`src/db/views.ts` declares all six with `.existing()`, which tells drizzle-kit that
something else owns the definition. The file is kept OUT of `src/db/schema/index.ts`,
because that barrel is what drizzle-kit reads to decide what it manages; keeping views
outside it means no future `db:generate` can decide to emit a `DROP VIEW`. Queries do not
need the barrel — the view object carries its own definition. Verified: `db:generate`
reports no schema changes with the file present.

All six are described even though Phase 2 reads only the first, on the same reasoning as
C9. `tests/views.test.ts` selects every declared column from every view, so a column
renamed in a migration fails a test rather than a screen.

**F15 — The stage pill lightens in dark mode rather than switching colour.** Section 7
specifies the stage colour at 12% opacity behind solid text, which is a light-mode
instruction: a 12% wash of a dark slate is invisible on a dark background, and the solid
text on top of it is unreadable. Dark mode therefore lifts the tint to 22% and lightens
the text with `color-mix`, keeping the single hex from the `stage` table as the only
input — the same approach as the brand indigo in E16.

Non-negotiable 5 is what shapes the component: there is no map from stage code to colour
and no default palette. The colour and the label both arrive from the `stage` table via
`v_po_item_status`, so recolouring a stage on the Admin screen recolours every pill in the
app, and a stage added to the table renders correctly the first time it is used.

The tint rules are scoped with `:not(.stage-pill--none)` rather than being overridden
afterwards. Found by checking dark mode: `.dark .stage-pill` out-specifies
`.stage-pill--none` two classes to one, so the neutral "not started" pill was painted with
an unset `--stage-colour`, which `color-mix` resolves to fully transparent. An invisible
pill, in dark mode only — the kind of thing that ships unless somebody actually looks.

**F16 — Approval is an action, not a form field.** Spec 6.5 asks for "approval action with
timestamp", and the difference from a dropdown matters: `design.approval_status` is the
gate on whether anything goes to plate, so somebody editing a paper size should not be
able to approve the artwork on the way past. It sits in its own panel below the form with
its own buttons, alongside retire and remove, in the same shape the client screen uses.

Moving OFF `Approved` clears `approved_at` and `approved_by`. The database's
`design_approval_complete` check only constrains the `Approved` case, so nothing else
would stop a rejected design still displaying the name of the person who approved an
earlier version of it.

**F17 — Removing a process from a design's route and adding it back RESTORES the row.**
`design_process` carries a full unique constraint on `(design_id, stage_code)`, not the
partial one used for natural keys (C5) — correct for a junction row, since there is no
code to free for reuse. The consequence is that a soft-deleted route row is still visible
to the constraint, so re-adding lamination to a design that once had it cannot be an
insert. The write path restores instead. `tests/design-route.test.ts` pins both halves:
that the naive insert genuinely fails with the constraint name, and that restoring is the
way through. Without the first assertion the second reads as unnecessary ceremony and gets
simplified back into a bug.

**F18 — `stage.is_process` separates floor work from order lifecycle.** The design route
editor read every active stage, which non-negotiable 5 requires but meant ENQUIRY,
COSTING and PO_RECEIVED were offered as manufacturing steps. Nothing broke; they are simply
not things a design "passes through" the way LAMINATION is.

`stage.is_process` now carries that distinction, seeded in migration 0007:

- **true** — DESIGN, MATERIAL_READY, PRINTING, LAMINATION, UV, FOILING, DIE_CUT, PASTING.
  Things that happen to paper.
- **false** — ENQUIRY, COSTING, PO_RECEIVED, APPROVED, READY, DISPATCHED. Things that
  happen to an order.

It filters the design route editor and **nothing else**. Stage Update offers every stage
regardless, because Preeti has to move a job to READY and to DISPATCHED and neither is a
route step — the flag describes what a design's route may contain, not what a stage event
may be.

The column defaults to true, on the grounds that a stage added later is far more likely to
be a new floor process than a new lifecycle point, and that offering one option too many
in the route editor is a smaller error than silently hiding a real process. It is editable
on the Admin stage config screen, so the factory's vocabulary can change without a
migration — which is the same reasoning that keeps stages in a table rather than an enum
(C3).

**F19 — A PO item and its opening stage event are created together, always.** Spec 6.3
asks for a `PO_RECEIVED` event per item on save. It is written in the same function that
inserts the item — `insertPoItem` in `src/modules/purchase-orders/actions.ts` — rather than
alongside it at each call site, so there is no path that produces an item with no stage
history. That matters because an item whose `current_stage` is null is indistinguishable
from one somebody forgot to update, and the Item Tracker exists precisely to answer "where
is this?" without asking a person.

The event is dated by the **PO date**, not by the clock, on the same reasoning as F3 for
dispatch: a PO entered three weeks late is three weeks old, and dating it now would make
every ageing figure derived from it wrong in the flattering direction. `startOfDayIST()`
in `src/lib/dates.ts` does the conversion, and is the TypeScript counterpart of
`today_ist()` in the views (C10). A test asserts the resulting UTC instant, because the
whole point is that a naive parse would land on the wrong day.

**F20 — The PO capture form holds everything in React state.** Not a style preference. The
duplicate-PO-number question (F7) sends the form back to ask, and an uncontrolled form
whose fields reset at that moment would discard a ten-line purchase order to query a typo.
Rows also have to be addable and removable, which needs state regardless.

The confirmation itself rides on the "Save anyway" **button's** own `name`/`value`, not a
hidden input driven by state. Found while writing it: a click submits before React
re-renders, so a state-driven hidden input would arrive one submit late — the form would
ask the same question twice and the second answer would be the one that counted.

Items post as parallel arrays, one entry per field per row. Every row renders every field
including the empty ones, so array index i is row i throughout; a form that conditionally
omitted an input would silently shift every subsequent row's data by one.

**F21 — Cancelling a PO cancels its open items with it.** Otherwise the header reads
Cancelled while its items stay Open, and they go on appearing in the Item Tracker and on
Stage Update as live work against a dead order — the "stop asking people" failure the
tracker exists to prevent. Items already `Closed` are left alone: they were delivered, and
cancelling the order does not unhappen that.

Reinstating sets status back to Open and then runs the recompute rather than assuming Open
is right, because an item that was fully dispatched before being cancelled belongs at
Closed. Both directions go through `withStatusWrite` and the audit wrapper, so the Cancel
action is exactly the second sanctioned status writer B5 named — and nothing else.

Removing an item is separate and is for one entered by mistake. It is refused outright
once anything has been dispatched against it: soft-deleting then would leave live
`dispatch_line` rows pointing at a row nothing displays, while the challan still says the
goods went out.

**F22 — The Item Tracker's search state lives in the URL.** Query and the "open items only"
filter are both search parameters, so a search is a link. Preeti can send Punit the exact
screen she is looking at, the back button does what it appears to do, and the matching
rules stay in one SQL statement rather than being half-duplicated in the browser. The
input is debounced at 250ms — short enough to feel immediate at typing speed, long enough
that "NAT-2026" is one query rather than eight.

"Open items only" defaults ON. The question this screen answers is almost always about work
in progress, and a tracker that buries eighty live items under two years of delivered ones
answers it slowly.

**F23 — Search results sort overdue first, then nearest commitment, with NULLS LAST spelled
out.** Postgres sorts nulls FIRST in ascending order, so without the explicit `NULLS LAST`
every imported historical row — the ones with no committed date at all (F8) — would sit
above live work on the screen whose entire purpose is answering "where is this?". It is the
kind of default that produces a screen nobody trusts and nobody can quite explain.

**F24 — One search box across five fields, not five boxes.** Spec 6.4 lists item code, item
name, client, PO number and job card number. They are matched together with ILIKE, because
somebody being asked "where is the Nature carton?" has a fragment rather than a field name,
and frequently does not know whether the number they were given is ours or the client's.
Job card number is matched through an `EXISTS` rather than a join, so an item with three
job cards still returns once.

**F25 — The tracker shows no Invoices panel.** Spec 6.4 lists linked invoices, which are
Phase 5. An empty panel labelled "Invoices" on a screen that cannot yet have any is a
question rather than an answer — unlike the dashboard tiles, which say which phase they
arrive in because their whole layout is the point. Job cards are handled the other way and
are queried now, appearing only when there are any: they arrive in Phase 4 without changing
a screen people have already learned.

**F23 — A DISPATCHED stage event is written only when an item is FULLY delivered.** Spec
6.8 says the event goes in "where fully dispatched", and the distinction is load-bearing: a
partial delivery leaves the remainder in production, so moving the item to DISPATCHED would
take it off Stage Update while work continues on it. Partial delivery is the normal case
here, not the exception.

Which items qualify is read from `v_po_item_status` **after** the lines are written and
inside the same transaction, never worked out from the form. `pending_qty` is derived
(non-negotiable 2), so the view is the only thing that knows whether a partial delivery
from a previous month already covered part of this order.

The event is dated by the **dispatch date** (F3), and is skipped when the item is already
at DISPATCHED — so editing a challan does not stack duplicate events. An item that was
reopened by a cancelled challan and then completed again does get a second one, which is
correct: it happened twice.

Removing a line or cancelling a challan does **not** remove the events they caused.
`stage_event` is append-only (C6) and the item having reached DISPATCHED is a thing that
happened; moving it back is a Stage Update, and appears as a further row.

**F24 — Dispatch header editing cannot change the client.** Every line's item belongs to
the current one and the cross-client trigger (C8) would refuse, so the field is not
offered. Moving a delivery to another client means entering it as a different challan,
which is also what actually happened.

Changing the dispatch DATE is allowed, and the DISPATCHED events already written keep their
original date. That is not an oversight: a correction to history is an appended row, never
an edit to an old one, and the timeline showing both is the honest record.

**F22 — A Draft challan is typed but not gone, and consumes nothing.** Until migration
0008 everything that asked "which challans count?" asked it as `status <> 'Cancelled'`, so
a draft reduced `pending_qty` exactly as a dispatched one did. Starting a draft therefore
made an item disappear from the list of what a client was still owed, which is the opposite
of what a draft should mean.

The definition is now a POSITIVE list: goods have left when the challan says
`'Dispatched'`. Positive rather than `NOT IN ('Draft', 'Cancelled')` because the failure
modes are not equal. If a status is added later, an exclusion list would silently start
counting it — over-counting hides work that is still owed, and nothing surfaces it. A
positive list would silently stop counting it, which shows up as quantity still owed and
gets noticed.

Three things had to move together, and the change is wrong without any of them:

1. **The views.** `v_po_item_status` and `v_client_summary`'s own `dispatch_value` CTE,
   which joins `dispatch_line` directly rather than through the spine view. Missing the
   second would have left a client's dispatched VALUE counting drafts while their pending
   QUANTITY did not — a disagreement nobody reconciles until it is queried in a meeting.
2. **The quantity ceiling.** `dispatch_line_guard()` now uses the same definition, so
   "consumes order quantity" has exactly one. A line on a non-dispatched challan is not
   checked at all, because it consumes nothing yet.
3. **A new guard on the transition**, which is the hole this change opens. With drafts not
   counted, a draft for 1000 and a dispatch for 1000 against an order of 1000 are each
   individually valid and jointly impossible; promoting the draft would put 2000 against
   the item. The line-level trigger cannot see it, because promoting a draft touches no
   line. `dispatch_consumption_guard()` fires on the transition INTO consuming — becoming
   `'Dispatched'`, or being restored from a soft delete while already `'Dispatched'` — and
   names the first item that does not fit.

On the application side, promotion is the moment the goods left, so it is the moment the
DISPATCHED stage events are written (F23's rule, at the new time). Creating a draft writes
none; marking it dispatched writes them, dated by the challan; reinstating a cancelled
challan does the same, because that is also a transition into consuming.

**F25 — F4's precedence is a pure function, tested without a database.**
`src/modules/stage-update/precedence.ts` holds `stageChoicesFor()` and
`isBackwardMove()`, extracted from the screen for the same reason the stage-config diff was
(E14): this is the rule most likely to be argued about a year from now, and an argument is
far easier to settle against a test than against a component.
`tests/stage-precedence.test.ts` runs in about a tenth of a second with no database, no
session and no browser.

The function returns TWO lists rather than one filtered list — `route` and `other` — which
is how F4 and F18 hold together. F4 says the design's route takes precedence over
`applies_to`; F18 says Stage Update still offers every stage, because Preeti has to move a
job to READY and DISPATCHED and neither is a route step. So precedence orders the dropdown
rather than trimming it: the item's own route comes first under a heading that says why it
is the route, and everything else follows under "Other stages". A test asserts the two
lists together are always exactly the whole table — a dropdown that hides the stage
somebody needs at 6pm gets worked around, and the workaround is worse than the wrong order.

`is_optional` filters neither list. It is carried through so the screen can mark a stage as
one not every job needs, which is guidance rather than a restriction.

**F26 — The direction of a stage move is never validated on the server.** Backward moves
are allowed (F4), and the confirmation lives at the screen where the person can see what
they are about to do. Enforcing it in the action would make rework impossible rather than
deliberate, and rework that the system refuses to record is rework that happens anyway and
goes unrecorded.

The confirmation dialog's confirm button is a plain submit inside the same form, so the
click that confirms is the click that submits — the same trap as the duplicate-PO button
in F20, where a state flag set on click arrives one submit late.

**F27 — The phone view omits everything except the stage, deliberately.** Spec 6.7 asks for
"card list, large tap targets, single stage dropdown, nothing else", and the omissions are
the design: no bulk select, no remarks, no event time. Ajay is standing next to a machine
holding a phone in one hand, updating what just happened, and every field that is not the
stage is a field he has to get past. The desktop grid has all three, because Preeti is
catching up on a day at a keyboard and the event time is the difference between WIP ageing
that means something and WIP ageing that measures typing.

Both layouts are rendered and CSS decides which is visible, rather than measuring the
viewport in JavaScript — server-rendered markup that does not depend on a measurement
cannot flash the wrong layout before hydrating.

The desktop event-time field is a `datetime-local`, which carries no timezone. It is typed
by somebody standing in the factory, so the action parses it as IST explicitly (C10).
Letting it fall through to the server's local time would silently shift every batch entry
by five and a half hours.

**F28 — The importer is its own resource, granted to ADMIN and ORDER_DESK.** It writes
purchase orders AND dispatches, so granting it to ORDER_DESK is a deliberate widening:
Punit cannot reach the Dispatch screen but can create dispatch rows through a bulk import.
That is what the requirement asks for — "later batch catch-up by a data-entry person" — and
the importer is a far more constrained instrument than the dispatch screen. It only records
deliveries that already happened, every row is previewed before anything is written, and a
whole batch can be reversed in one action.

**F29 — Validation is a pure function, and it is the whole safety of the feature.**
`src/modules/imports/validate.ts` takes strings and lookups and returns a verdict per row.
No database, no file parsing, no session — so the rules that decide what reaches the
database are tested directly rather than through an upload. Three of them are worth
restating:

- ~~**An unmatched client is refused, never created.** Auto-creating from a spreadsheet is
  how "Nature Packaging", "Nature packaging Pvt Ltd" and "NAure Packaging" become three
  customers nobody notices until a report is split three ways.~~ **Superseded by F32**,
  which keeps the reasoning and changes the rule: creation is allowed where nothing on
  file resembles the name, and a name that resembles one goes to a human instead of being
  refused outright. The three-spellings failure is still the thing being prevented — it is
  now prevented by the near-match check rather than by refusing everything.
- **An error stops its own row and nothing else.** Forty jobs with two bad dates import
  thirty-eight.
- **Dates are read day-first.** Not cosmetic: `03/04/2026` is a different day under each
  convention and both parse silently, so guessing would put a job three weeks out with
  nothing to show for it. A blank committed date is accepted and flagged (F8); a committed
  date that is present but unreadable is refused, because importing it as blank would hide
  a typo.

Rows sharing a client and PO number become items on ONE purchase order, and rows sharing a
client and challan number go on ONE challan. Rows with no challan number get one each,
since merging every un-numbered delivery in a file into a single challan is not what
happened.

**F30 — The confirm step re-validates everything server-side.** The preview travels to the
browser and the raw rows come back with it, which is a convenience and not a trust
boundary: only rows the second pass accepts are written, so nothing can be posted in that
the validator would have refused. The lookups are re-read too, because the database may have
changed since the preview was produced.

The parser and the template are two readings of one format, kept in a single `COLUMNS`
array. When they drift the failure is unpleasant in a specific way — the template teaches
somebody to fill in a file the importer cannot read, and the error arrives as "PO date is
blank" on a spreadsheet where the PO date is plainly filled in — so a round-trip test
builds the template, writes rows into it and parses them back.

One thing that only showed up in that round trip: a date cell with no date format reads
back as the raw Excel serial (`46117`), and `46117` is a perfectly plausible quantity. Only
knowing which COLUMN a value came from makes it a date, so `COLUMNS` marks the date fields
and the parser converts serials in those columns alone.

**F31 — Undo is a soft delete, and cannot be anything else.** `stage_event` is append-only,
enforced by a trigger, so the PO_RECEIVED and DISPATCHED events a batch wrote cannot be
removed. Soft-deleting the `po_item` rows takes them out of `v_po_item_status` and every
view built on it, leaving those events attached to rows nothing displays. That is the right
outcome rather than a workaround: what was entered and then withdrawn is exactly what an
audit trail is for.

Only rows CARRYING the batch id are touched, which is what makes attaching safe. An order
the batch added an item to but did not create keeps its null `import_batch_id` and survives
with everything else on it. Dedupe keys are built from live rows only, so an undone batch
stops blocking a re-import — undo exists so a bad spreadsheet can be fixed and run again.

**F32 — The importer matches clients tolerantly, creates them where there is no doubt, and
refuses to decide where there is.** Amends F29's first bullet, which refused every
unmatched name outright. That rule was safe and unusable: the paper book says
"NATUREEXPERT AYURVEDIC PVT LTD", the client list says "Natureexpert Ayurvedic", and forty
rows were refused over a difference nobody would call a difference.

The replacement has three outcomes and the third is the whole point.

1. **Normalise both sides before comparing.** Lowercase, collapse internal whitespace,
   trim, strip trailing punctuation, and strip legal suffixes from the end — pvt, pvt.,
   private, ltd, ltd., limited, llp, & co, and co, co., inc — repeatedly, so "pvt ltd"
   comes off in two passes. A company does not become a different customer on the day
   somebody stops typing "Pvt Ltd" after its name. A name that is *nothing but* a suffix
   keeps it, because stripping "Ltd" to an empty string would make it match every other
   name stripped to empty. Codes are matched exactly and are **not** suffix-stripped: a
   code is an identifier, not a name, and is tried first.

2. **Exact after normalising → use the existing client, silently.** No note on the row.

3. **Nothing resembling it → create it.** Stored with the name **as typed in the sheet**,
   casing preserved — normalising is for comparing, never for storing. The row carries
   `import_batch_id`, which does two jobs: it puts the client inside that batch's undo, and
   it is what the "created by import, unreviewed" filter on the client list selects. The
   `code` is generated (first three letters of the first word, numbered on collision:
   NAT, then NAT2), which is a placeholder that wants attention — and attention is exactly
   what that filter exists to send.

4. **Similar but not identical → decide nothing.** The row is flagged in the validation
   preview with both names side by side and a per-row choice: use the existing client, or
   create a new one. Undecided rows are excluded from the import as firmly as refused ones,
   whether or not anybody looked at the screen. Without this, auto-creation *is* the
   three-spellings failure F29 was written to prevent.

**The similarity measure is trigram Jaccard — `|A ∩ B| / |A ∪ B|` over word-padded
character trigrams, the same thing Postgres `pg_trgm.similarity()` computes. The threshold
is 0.45.**

Trigrams rather than Levenshtein because they ignore word order and degrade gracefully
with length difference, and because matching pg_trgm's definition means this can move into
SQL later without the numbers shifting under the threshold. It runs in TypeScript for now
so F29's "validation is a pure function" property survives.

0.45 was calibrated against realistic client names rather than picked. Genuine variants
score from about 0.48 up — "Naturexpert Ayurvedic" against "Natureexpert Ayurvedic" is
0.88, "Aarav Carton" against "Aarav Cartons" 0.80, "Amrit Pharmaceuticals" against "Amrit
Pharma" 0.52, "Perfect Print Solutions" against "Perfect Prints LLP" 0.48. Unrelated names
score below about 0.12 — "Zenith Graphics" against "Ganesh Packaging" is 0.03. Nothing in
that sample lands in between, so the threshold sits in open space rather than on a cliff
and being slightly wrong either way changes no answer. It errs LOW deliberately: a name
sent to review that did not need it costs one click, and a name created that should have
matched costs a duplicate customer and a report split in two.

**A token-containment rule ignores the threshold entirely.** If one normalised name's words
are wholly contained in the other's, it goes to review whatever it scores. "Bharat Box"
against "Bharat Box Makers" scores 0.59 and "Ganesh Packaging" against "Ganesh Packaging
Industries" 0.61 — dragged down by the length difference however identical the shared part
is — and a name that is entirely a subset of another is the most likely duplicate shape
there is.

**A fifth outcome had to be invented: ambiguity.** If two live clients normalise to the
same string — "Acme Packaging" and "Acme Packaging Pvt Ltd" both on file — the row is
REFUSED with an instruction to use the client code, not resolved to whichever came back
first. Picking one is a coin toss that attaches real orders to the wrong customer and says
nothing about it. It is rare by construction, since the near-match rule is what stops such
a pair being created in the first place.

**Decisions are keyed by the normalised NAME, not by row.** That is what makes requirement
5 — two rows in one file normalising to the same name resolve to ONE client — a property
rather than a promise: there is one place to record the answer, so two spellings cannot
become two clients. The control is still rendered on every affected row, so the choice is
made where the row is; setting it on one row settles all of them.

**The preview screen runs `validateRows` itself, in the browser.** A decision changes the
verdict for every row sharing that name and the counts above the grid have to follow, which
otherwise means a round trip per click or a second copy of the rules in the component — and
the moment two copies exist, one is wrong. The upload action therefore returns the INPUTS
(rows, client list, dedupe keys) rather than a verdict. F30 is untouched and is what makes
this safe: confirm re-runs the same function on the server against freshly re-read lookups,
and only what that pass accepts is written. A decision naming a client that has since been
deleted falls back to review and stops its row.

**Undo removes the clients a batch created**, and only those. One it merely matched against
carries a null `import_batch_id` and survives — the same rule that protects a hand-typed
purchase order the batch attached an item to (F31). Clients are soft-deleted last, after
everything pointing at them has gone. Without this, auto-creation would be a one-way door
and "a whole batch can be reversed in one action" would quietly stop being true.

**`client.import_reviewed_at` / `import_reviewed_by` are separate from the batch id**, and
are what makes the filter mean something. The batch id is where the row came from and stays
true forever; reviewing is a thing that happened afterwards. Marking a client checked does
not clear the batch id, because that would silently take it out of an undo the Import
History screen is still offering.

**There is no design lookup to normalise.** The requirement asks for the same treatment on
design lookup by name; the importer's file format has no design column and the write path
never touches `design`, so there is nothing to apply it to. Recorded here so the absence
reads as checked rather than missed.


---

## G. Delegation (BMP Week 9)

The first module in this system that the **v1 spec does not describe at all**. It comes
from the Business Mastery Program rather than from `JSS_MIS_v1_SPEC.md`, and it is
orthogonal to the six build phases rather than jumping ahead of them — nothing in Phases
2–6 is pulled forward by it. Settled 25 Aug 2026, before any code was written.

Its whole output is one number per person: what fraction of the one-time tasks they were
given were finished on time. Every decision below exists to stop that number being
gameable, because a score that can be tidied is worse than no score — it is a false
assurance read aloud in a meeting.

**G1 — Delegation is for ONE-TIME tasks, and everyone is on it.** `delegation` is granted
to every role including FLOOR and OWNER. Accountability that skips the people at either end
of the org chart is not accountability. ADMIN may delegate to anyone; everybody else may
delegate only to themselves, which makes the module usable as a personal commitment log
without letting the org chart be rewritten from a form.

`delegation_scorecard` is ADMIN and OWNER only. It is a screen about people, and the people
on it should not have to discover their own number from over a colleague's shoulder.

**G2 — OWNER may write ONE table, three columns, on his own rows. This is a documented
exception to B2, not a softening of it.**

B2 makes OWNER globally deny-write, enforced inside the audit wrapper so that a future
screen which forgets its guard still cannot let an OWNER write. Amit is OWNER and belongs
on the delegation scorecard, which requires him to mark his own tasks done. Three options
were on the table and the reasoning matters more than the choice:

| Option | Verdict |
|---|---|
| **(a) Narrow exception in the wrapper** | **Taken.** |
| (b) A second, non-OWNER account for him | Rejected — see below. |
| (c) He stays on paper | Rejected: a scorecard read aloud in a meeting that omits the most senior person in the room is a political instrument, not a factual one. |

**(b) looks like the conservative option and is not.** Leaving the wrapper untouched feels
safer, but a second account carries a whole ROLE's write surface — every table that role can
touch — to buy that appearance, where (a) grants three columns on rows already assigned to
him. It also breaks one-person-one-identity in the audit log, which E11 established this
system depends on: audit rows are read by username, and two accounts for one human means the
log and the scorecard both attribute his work to two people, or need a "these are the same
person" mapping that has to be maintained and can silently go wrong.

The exception is declared in `src/db/audit.ts`, beside B2 rather than inside the delegation
module, because a rule enforced in one file and excepted in another is a rule that quietly
stops being true. All four conditions are required together:

1. the table is `delegation_task` and nothing else;
2. the operation is UPDATE — `auditedInsert`, `auditedAppend`, `auditedSoftDelete` and
   `auditedRestore` all still refuse an OWNER outright;
3. the row's **stored** `assigned_to` is the actor, read from the database inside the
   transaction and never claimed by the caller;
4. every field written is in `SELF_WRITABLE_FIELDS` — `status`, `completed_at`,
   `blocker_note`. Not one of them: all of them, so a forbidden field cannot ride along
   beside an allowed one.

Condition 4 is the point of the whole module. `expected_date`, `task` and `assigned_to` are
not on the list, so the one person nobody can overrule still cannot move his own deadline,
reword his own task, or hand it to somebody else.

**Narrower than requested, in one respect.** The option as put was "may write rows where
`assigned_to` = self", which would include INSERT. It is UPDATE only, so Amit cannot create
a task for himself even though other non-admins can self-delegate. His tasks come from the
meeting rather than from himself, which is right for an accountability instrument; widening
it later is a one-line change.

**What this costs, written down because it is real.** B2 stops being a sentence anybody can
hold in their head: "OWNER never writes" becomes "OWNER never writes except one table, three
columns, own rows, update only". `audit.ts` — deliberately generic — now knows the name of a
business table. `audit_log` will contain rows authored by an OWNER, which surprises anyone
who internalised the old invariant. And a year from now, adding a field to
`SELF_WRITABLE_FIELDS` is a two-word edit that will look innocuous.

Only the last has a real mitigation, and it is `tests/delegation-owner.test.ts`: eleven
tests, eight of them negative, pinning every edge of the boundary. The exception is narrow
in FACT only for as long as those pass.

**G3 — Cancelling is not something the assignee can do, and cancelled tasks leave the
score.** These two rules hold together or not at all, and neither was in the original
requirement.

The requirement said the assignee may change `status`, and `Cancelled` is a status. If
cancelled tasks are excluded from the scorecard denominator, an assignee cancels whatever
they are about to miss and scores 100% — silently and completely. If cancelled tasks stay in
the denominator, a task genuinely withdrawn by the person who set it punishes the assignee
forever.

So: only `assigned_by` or ADMIN may cancel, and cancelled tasks are then safely excluded
from `assigned`. Cancelling is not progress on a task; it is withdrawal of the task, which
is the delegator's to decide. This is the same principle the module already rests on —
the person doing the work does not move the goalposts — applied to the case of removing
the goalpost entirely.

Removal (soft delete) is closed the same way and for the same reason, and neither is
available once a task is `Done`.

**G4 — Reassignment is the delegator's, never the assignee's, and never on a finished
task.** Changing `assigned_to` moves a task's whole history onto somebody else, so:

- the assignee may never do it, or anybody could shed a task they were about to miss;
- a `Done` task may not be reassigned by anyone, because its result is already scored and
  moving it would rewrite something that has been read out.

The audit trail requirement is met by the wrapper's existing whole-row before/after
snapshots, which name both people; `reassignmentsFor()` reads exactly those rows back so the
task screen shows the move as a sentence rather than as two JSON blobs to diff.

**The residual risk is stated rather than designed away.** A delegator CAN still move a late
open task off somebody. Refusing that would be worked around by cancel-and-recreate, which
loses the history entirely — so the protection is "the person being measured cannot do it",
and the audit row is what makes the rest visible. That is weaker than airtight and is
recorded here as such.

**G5 — There is deliberately no recurrence field, and this is a constraint against future
requests.** Recurring work belongs on a checklist, which is a different instrument. A
repeating task here either scores once — making the repetition pointless — or scores every
occurrence, drowning genuine one-time commitments under routine ticks. Either way the number
stops meaning what the meeting thinks it means.

Utkarsh asked explicitly to be pushed back on and shown this line if he later requests
recurrence. Treat it the way the section 10 non-negotiables are treated: a constraint set
against a future self, to be raised rather than quietly accommodated. He can still overrule
it; the point is that it is a decision rather than a drift.

**G6 — `days_late` freezes when a task is finished.** The view reads `completed_at` first,
so a completed task's lateness is a fact about the past and stops moving. Reading the clock
instead would make a job delivered two days late grow later every morning.

That ordering is why `delegation_completed_at_only_when_done` exists as a CHECK constraint:
a completion date left behind on a task moved back to In Progress would be read by the first
branch and freeze the task's lateness at a value that is no longer true. Moving off `Done`
therefore clears the date, and forgetting is an error rather than a quietly wrong score.

Early is not negative-late — `GREATEST(0, ...)` — because rewarding earliness pushes people
to pad their dates, which is the failure mode that makes an on-time percentage meaningless.

**G7 — The score is on-time over ASSIGNED, and is NULL rather than zero when there is
nothing to score.** Dividing by `done` would give somebody who completed one task on time
and abandoned nine a perfect 100%; finishing nothing has to score nothing.

`NULL` matters because this screen is read aloud. "No score yet" and "scored zero" are
different statements about a person, and the screen renders the null as an em dash rather
than as 0%.

**G8 — The scorecard has no interaction at all.** No filters, no sorting controls, no row
actions, and type larger than anywhere else in the app. Somebody projects it and talks
through it, and every control on the screen is a thing to click by accident while eight
people watch. It is ordered worst-score-first so the conversation starts where it needs to
rather than wherever the alphabet puts it.

**G11 — An action that removes the row the page is showing has to say where to go.**

Removing a task from its own screen returned a 404. `auditedSoftDelete` takes the row out of
`v_delegation_status`, the detail page reads that view, and the page calls `notFound()` on a
null — so the confirmation for removing something was an error page.

Withdrawing does NOT have this problem and deliberately does not redirect: a cancelled task
still exists and the screen can still show it, which is the whole distinction between the
two buttons (G3). Only removal makes the page unreachable. Both halves are pinned by tests
that assert what `getTask` can still find after each.

The fix follows the `redirectTo` convention already used by the design, PO and dispatch
forms: the action returns where to go and the component pushes there. Calling
next/navigation's `redirect()` inside the action was the obvious alternative and is a trap —
it works by throwing, and every action in this module is wrapped in a try/catch that would
swallow it and report a successful removal as a failure.

**The same defect exists on three Phase 2 screens** and is recorded in
[`BACKLOG.md`](BACKLOG.md) rather than fixed here, to keep this commit reviewable:
`/clients/[id]`, `/designs/[id]` and `/admin/users/[id]` all call `notFound()` on a missing
record while their remove actions return `ok()` with no redirect.

**G10 — An absent form field is null, not undefined, and that shipped as a bug.**

Every status change on My Tasks was silently refused. `FormData.get()` returns **null** for
a field the form did not render; zod's `.optional()` permits `undefined`, not null. The
status form renders the completion date only for Done and the blocker note only for Blocked,
so at least one of the two was always absent — and the schema rejected the whole payload
with "Invalid input" naming a field the person could not see on their screen.

Every test passed while that was true. The rules were tested by calling them with
hand-written objects, and a hand-written object is what the author already believes the form
posts, so it can only ever confirm the belief. The parse step between the browser and those
rules was the one thing nothing exercised.

Two changes, and the second matters more than the first:

1. `absentOrBlank()` in `validation.ts` normalises null and "" to undefined before the inner
   schema sees them. Everything reading an optional value out of a FormData goes through it.
2. `parseStatusPatch(formData)` moved OUT of the action and into `validation.ts`, purely so
   the form contract can be tested with a real `FormData`.
   `tests/delegation-form.test.ts` builds one with exactly the fields each status renders,
   and `tests/delegation-views.test.ts` runs the whole path — parse, rules, normalise,
   write — down to a row read back out of Postgres.

The general lesson is about where the seam was, not about zod: a boundary that converts
untyped input into typed input is the boundary most worth testing from the untyped side,
and it is the one that unit tests structurally cannot reach.

**G9 — The dashboard tile counts what is PENDING, with overdue underneath it.**

The first version showed overdue only, and appeared only when the count was above zero. The
reasoning was sound for an exception metric — a permanent "0 overdue tasks" trains people to
stop reading that corner of the screen — and it was the wrong metric. On any day when
nothing happened to be late, the module vanished from the dashboard entirely, so the one
screen everybody lands on said nothing at all about work they had been asked to do.

The tile now shows **pending** — Not Started, In Progress or Blocked — and is shown even at
zero, because pending is a WORKLOAD figure like "items in production" rather than an
exception. Nothing outstanding is a genuine and useful answer; an absent tile is not. The
overdue count rides underneath in red rather than colouring the number, because five pending
of which two are late is not five late tasks. The whole tile is the link, and it opens My
Tasks, which already defaults to exactly these.

Both numbers come from **one** query (`taskCountsFor`). Two separate counts against a moving
clock can straddle midnight IST and report more overdue than pending — a nonsense nobody
reports and everybody quietly stops trusting.

It is deliberately not a `MetricCard` with a phase placeholder: this module is built, so the
number is real. `MetricCard` grew an `href` for it, which spec 6.1 wants for the overdue and
at-risk tiles too when Phase 3 fills them in — and it refuses to link while a tile is still
a placeholder, since a link to an empty screen is worse than no link.


---

## H. Press runs — ganging (outside the v1 spec)

Roughly three to eight jobs a month are **ganged**: items from DIFFERENT clients printed
together on one plate to fill a sheet. The system could not represent that at all, so the
Item Tracker implied every job ran standalone — false about one job in twenty, and false in
the direction that makes the factory look simpler than it is.

Settled 26 Aug 2026, before any code.

**H1 — Ganging is a grouping ABOVE job cards, not a loosening below them.** `press_run` is a
new table and `job_card.press_run_id` is a nullable foreign key to it. `job_card.po_item_id`
is untouched and still NOT NULL: **one job card is still exactly one PO item.** What changes
is that several job cards may share a run.

This supersedes exactly one line of spec section 3 — *"No ganging across clients in v1"* —
and leaves the cardinality rule beside it (*"one job card = one PO item"*) exactly as
written. A test asserts `po_item_id` still points where it did after a card is ganged, so
the spine rule cannot be broken by the back door.

Nullable is the design, not a convenience: the overwhelming majority of job cards are not
ganged and must stay exactly as they are. A null means "printed on its own", which is both
the common case and the truth about every row that already exists. Nothing is backfilled.

**H2 — Three things this deliberately does NOT do.** All three were considered and excluded,
and the reasons are the point:

- **No cost splitting across clients.** The allocation rule — by ups, by area, by quantity —
  is genuinely unknown. Picking one here would be *inventing* a number rather than
  discovering it, and an invented cost is indistinguishable from a measured one once it is
  in a column. It belongs with the costing engine, which spec section 1 puts out of scope
  for v1 entirely.
- **No shared scheduling or capacity logic.** That is Phase 4 and it needs machine timings
  that do not exist — the same absence spec section 1 already names as the reason this
  system cannot produce utilisation or bottleneck detection.
- **No constraint that ganged job cards share a stage or move together.** They diverge
  legitimately the moment they come off the press: one goes to lamination, another straight
  to die-cut. A rule forcing them to move together would be wrong on the floor within a day,
  and rules that are wrong on the floor get worked around rather than reported.

**H3 — Cross-client is normal here, and there is NO guard against it.** This is the one place
in the system where two clients on one record is correct. Migration 0001's triggers refuse a
`dispatch_line` whose item belongs to another client, and an `invoice_line` likewise (C8) —
because on a challan a second client means somebody picked the wrong row. On a plate it is
the entire reason the plate exists.

So `press_run` has no client column, no cross-client trigger, and nothing on the run screen
is coloured to suggest a mixed client list is a problem. Written down because the
inconsistency with C8 is deliberate and looks exactly like an oversight: anybody "fixing" it
for consistency would be removing the feature.

**H4 — The badge counts the OTHERS on the plate.** "Ganged with 2 others", not "3 job cards
in this run" — the reader should not have to do the subtraction to learn what they wanted to
know. A run holding one card reports zero others and renders as a plain link to the run
rather than as "ganged with 0 others"; that state is real and transient, since somebody
starts a run and adds the second job a minute later.

**H5 — There is no run status, and "open" means recent.** The requirement said "pick an
existing open run", and `press_run` has no status column because a press run is a thing that
happened on a date rather than a thing that is open or closed. Rather than invent a
lifecycle nobody asked to maintain, the picker offers runs from the last 30 days, newest
first, and calls them *recent* on the screen. Older runs stay reachable by number from the
item they were printed with. A real open/closed distinction remains available as a later,
deliberate addition rather than something that arrived by implication.

**H6 — There is no job card screen to hang the action off, so it lives on the Item Tracker.**
Found while planning: nothing in the application creates a job card. Every reference to
`job_card` is a read, `job_planning` is Phase 4 and not in `BUILT`, and `getItemJobCards`
says so in its own comment — *"Job cards are created in Phase 4, so this returns nothing
today."*

Two consequences, both accepted knowingly. A job card screen was NOT built, because Phase
4 features are not built early. And **this feature is inert until Phase 4**: there are no job
cards to gang. It is shipped now because getting the schema shape right before the planning
board is written is worth more than the delay costs.

"Add to press run" therefore lives in the Item Tracker's job cards panel — the only place a
job card is visible today — gated to ADMIN and PLANNER. The Phase 4 planning board will call
the same server action.

Access follows that split: `press_run` is write for ADMIN and PLANNER, read for everybody
else, because the ganged badge links to the run and every role can see the Item Tracker. No
sidebar entry and no list screen, per the requirement — a minority case is reached from the
job it belongs to.

**H7 — A correlated subquery must not use drizzle's `${column}` interpolation, and a shipped
bug proved it.** Found by a failing test on the run picker's job count.

Drizzle qualifies a column reference inside a raw `sql` template only when the surrounding
query has more than one table in scope. In a single-table query it renders bare names, so

```
select count(*)::int from ${jobCard} where ${jobCard.pressRunId} = ${pressRun.id}
```

becomes `where "press_run_id" = "id"` — and inside `from "job_card"` **both** names resolve
to `job_card`. The subquery asks whether a job card's `press_run_id` equals its own `id`,
which is never true. No error, no warning, every count silently zero.

**The same shape had already shipped in `listImportBatches`**, where `liveItems` was
therefore 0 for every batch — and the Import History screen hides the Undo button when that
count is 0. So the batch undo, the entire safety net behind "a whole import can be reversed
in one action" (F31), was **unreachable from the UI** while the data and the action behind
it were perfectly correct. Both are now written with explicit table names and aliases, and
both have a test that fails if the correlation breaks again.

The general rule: in a correlated subquery, write the table names out. The interpolation is
convenient and its failure mode is a plausible number rather than an error.


---

## I. Tooling register (outside the v1 spec)

The physical tooling the factory owns — plates, foil blocks, dies and embossing blocks.
Punit (ORDER_DESK) owns the register and logs everything. Not in `JSS_MIS_v1_SPEC.md`;
like Delegation (G) and press runs (H) it is orthogonal to the six build phases rather
than pulled forward from one.

Settled 27 Aug 2026, before any code.

**I1 — One table with a type discriminator, not four near-identical tables.** Every
question anybody actually asks of a piece of tooling is the same question for all four
kinds: where is it, what condition is it in, whose job is it for, what replaced it. Four
tables would mean four screens, four queries and four places to forget a filter — and the
first time somebody asks "what is in rack 3" the answer would need a union of all four.

**I2 — One number series per type, financial-year scoped.** PLT, FBL, DIE and EMB, all
through the shared allocator (C7), all taking their year from the tool's MADE date rather
than from today (F10) — a die cut in March belongs to that financial year whether it is
entered that week or a year later.

Worth recording that this cuts against the reasoning printed beside DSN in
`src/lib/numbering.ts`: that series is deliberately NOT year-scoped because *"a die or
plate design outlives any financial year"*, and a physical die outlives it more literally
still. Year-scoped anyway, as specified, and defensibly — `DIE-2026-0007` tells you roughly
when the die was cut, which is the first thing anybody asks about a worn tool. It is one
flag each to change if that reads wrong in practice.

**I3 — `client_id` is derived from the design by a database trigger, not by the action.**
The requirement says "derive from design when linked". Migration 0015 makes that true for
every writer, on the same reasoning as F11: a rule living only in TypeScript is a rule the
import script does not have and a psql session does not have at all. The symptom of missing
it is silent — a tool naming one client while pointing at another client's design, invisible
until the die is sent to the wrong customer.

The column is still STORED rather than always read through the design, because tooling with
no design can still belong to a client. Generic tooling for one customer is real, so the
column has to exist independently — and then the linked case has to be kept honest, which
is what the trigger does. It is a `BEFORE` trigger, so the row is never written wrong and
there is no second UPDATE to audit.

**I4 — "Which designs use it" can only ever be one design.** `tooling.design_id` is a
single nullable foreign key as specified, so a tool belongs to at most one design and the
detail screen shows at most one. Tooling genuinely shared between designs is NOT expressible
today and would need a junction table.

Recorded rather than quietly built: the requirement asks for "which designs use it" in the
plural, and the schema in the same requirement permits only the singular. Faithful to the
schema, and flagged so the gap is a known limit rather than a surprise.

**I5 — No issue/return workflow. `status` is a plain field somebody sets.** Explicitly
excluded: a checkout system is a daily-discipline burden nobody has agreed to carry, and a
half-kept one is worse than none because it still reads as authoritative. If tooling goes
to a vendor, Punit changes the status. There is no "issued to" person, no due-back date,
and no reconciliation — all three would be the beginning of the system that was refused.

**I6 — `colour` is not constrained to plates, though the form only offers it there.** The
requirement calls colour "meaningful for PLATE only", and a CHECK enforcing that was
considered and rejected: foil blocks have a foil colour, and a rule that is wrong on the
floor gets worked around rather than reported (H2's reasoning). So the field is hidden in
the form where it usually means nothing, the database stays permissive, and a value already
recorded on a non-plate is preserved rather than cleared.

**I7 — The four design columns are migrated and then DROPPED, in a three-step sequence
whose last step refuses to run early.**

`design.die_id`, `plate_id`, `die_status` and `plate_status` were free text answering the
same question the register now answers properly. Leaving both would be two sources of truth,
and the wrong one would always have been whichever nobody updated that week. So:

| Step | What |
|---|---|
| 0014, 0015 | create `tooling` and its client-derivation trigger |
| `npm run migrate:tooling` | dry run, then `-- --apply` |
| 0016 | drop the four columns |

**The ordering cannot be got wrong.** drizzle applies migrations in order, automatically, so
a plain `db:migrate` on a database that had not yet run the script would drop the only copy
of that data with no error and nothing to restore from. Migration 0016 therefore opens with
a `DO` block that counts live designs still holding die/plate text with no tooling row
against them, and raises — naming the script — if there are any. Verified in both directions
against the real database before shipping: it refuses while data is unmigrated, and passes
the moment the tooling row exists.

**TWO MISMATCHES BETWEEN THE OLD SHAPE AND THE NEW ONE, and neither is guessed.**

- `location` is NOT NULL and the design record has none. Migrated rows get the visible
  placeholder *"Not recorded — please update"* rather than a blank, which is impossible, or
  an invented rack, which is worse than either. This follows the same rule as A2: data
  nobody measured must not present itself as measured.
- The old vocabulary — Pending, Ordered, Received, Old, NA — is a PROCUREMENT state and does
  not map onto `condition` (what state the metal is in) or `status` (where it is). Guessing
  a mapping would put a value into an enum where it then reads as a fact somebody
  established. The original is preserved verbatim in `remarks` instead.

The PLAN is a pure function (`src/modules/tooling/migrate-from-design.ts`) so the dry run
and the apply compute the same thing from the same input — the report is not a separate
description of what the writer is believed to do. `scripts/migrate-tooling.ts` reads the
four columns by RAW SQL, because they are already gone from the schema file: the script is
the one thing in the repository that reads a pre-0016 shape, so it reaches past the schema
rather than holding the schema back. It stops working once 0016 has run, which is correct —
it has nothing left to do by then.

The `dieplate_status` Postgres TYPE is left in place and still declared in `enums.ts`.
Dropping a column does not drop its type, and removing the declaration would make
drizzle-kit emit a `DROP TYPE` as a side effect of tidying. It costs nothing where it is.

**I8 — The design screen shows the tooling attached to it, and that is what made the drop
possible.** Location and condition come back with each row, so nobody has to open a second
screen to learn where the die is kept — if they had to click through, the panel would have
failed at its only job. Shown to readers as well as writers: knowing where a die lives is
not an editing privilege.

**I9 — ORDER_DESK and ADMIN write; everybody else reads, and FLOOR reads it on a phone.**
Punit owns the register because he is the one who knows what a die is called and where it
lives. Ajay gets it read-only on mobile, which makes the register the second mobile-first
screen in the system after Stage Update — so the results have a card layout where location
is the largest thing on the card, rendered alongside the desktop table with CSS choosing
between them (F27's approach, and for F27's reason: server-rendered markup that does not
depend on a measurement cannot flash the wrong layout before hydrating).

Search covers tool number, name, LOCATION, client and design in one box (F24's reasoning),
with type, condition and status as separate filters — "show me everything Damaged" is a
browse rather than a search, and folding it into the box would match a tool whose remarks
merely mention the word.
