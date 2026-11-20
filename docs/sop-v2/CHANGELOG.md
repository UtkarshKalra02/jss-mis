# sop-v2 — changelog

What changed, when, and why. Newest first. Dates are DD-MMM-YYYY.

Nothing in this log has touched production. Work happens in the main working copy on
`main`, dev database first — the separate-project plan was dropped on 17-Nov-2026. See [STAGING.md](STAGING.md) for the
separation plan that was written and then not adopted.

---

## 18-Nov-2026 — W: job opening discipline (SOP Rule 1), phase 1.1

**The approach changed first.** Utkarsh, 17-Nov: no separate worktree, no separate staging
database, no separate deploy target — build the SOP work in the main working copy as small
additive changes, the way everything else here was built. `STAGING.md` is marked superseded
and kept; the brief is saved as `BRIEF.md`.

**Migration:** `0047_job_opening_discipline.sql`. Applied to **dev only**. Not on production.

| what | |
|---|---|
| new enum | `confirmation_source` — `PO` / `WhatsApp` / `Verbal` |
| new columns | `po_item.confirmation_source`, `confirmed_by`, `confirmed_at` — all nullable |
| new constraint | `po_item_confirmation_all_or_none` (explicit `IS NOT NULL`, per V2) |
| new index | `po_item_confirmed_at_idx` |
| new function | `working_minutes_between(timestamptz, timestamptz)` |
| new view | `v_job_opening` — the eleventh |
| new settings | `work_day_start_min`, `work_day_end_min`, `work_week_off_dow`, `job_open_target_working_minutes` |

**Rows updated:** none. **Views redefined:** none. **Triggers touched:** none.
`v_po_item_status`, `v_otd` and the other eight read exactly as before.

**The shift is 09:30–18:00, Sunday off**, confirmed by Utkarsh on 18-Nov after this was
first built with 18:30. `0047` was corrected in place and **re-applied to dev from a
standing start** — un-applied first, then run clean — which is also the proof V2 asked for
that it does not depend on anything having been done by hand. Overtime past 18:00 is not
counted, which makes the measure generous rather than harsh.

**Tests:** `tests/job-opening.test.ts`, 29 cases — the working-hours arithmetic (nights,
Sunday, before/after shift, the reversed pair, the UTC trap), the view's NULL-not-false rule
for unconfirmed rows, one case per missing column on the constraint, and `wallClockIST`.

**Not built, deliberately:** an `opened_at` column (it would duplicate `created_at`); the
"reached a stage without being opened" report (zero by construction). A confirmation cannot
yet be corrected after saving — a known gap, DECISIONS W5.

---

## 17-Nov-2026 — plan only, no code

**Files added**

| file | why |
|---|---|
| `docs/sop-v2/STAGING.md` | The staging setup, written down and **not run**. Every command that reads production is marked and waits for approval. |
| `docs/sop-v2/CHANGELOG.md` | This file. |

**Tables touched:** none.
**Migrations:** none.
**Production:** untouched.

**Read, not changed:** `docs/sop/2026-11-17_JSS_SOP-Manual-v2.md` (the requirements),
`docs/JSS_MIS_v1_SPEC.md`, `docs/DECISIONS.md`, `docs/BACKLOG.md`, the schema, the 10 views,
the 19 triggers, the role matrix.

**Two corrections to the brief, carried into the plan**

1. The SOP is at `docs/sop/2026-11-17_JSS_SOP-Manual-v2.md`, not `docs/sop/SOP-Manual-v2.md`.
2. The delegation ladder is **L2, L3, L4** — three levels, not the L2–L5 the brief
   describes. The SOP's BMP levels are 1–4. The mapping in §3.2 has to reconcile three
   stored values with four described ones, which is a decision rather than a rename.

**Disclosure.** Before this brief existed, earlier in the same session, read-only queries
were run against production; the baseline figures quoted in the brief (101 open, 79
overdue, OTD 18.2%, 68 stale, 3,340 pcs auto-closed) came from them. No production writes
were made then or since.

## 18-Nov-2026 — SOP coverage map

**Files:** `docs/sop-v2/COVERAGE.md` (new), `docs/BACKLOG.md`.
**Tables:** none. No schema change, no migration, dev untouched.

Utkarsh asked what still needs implementing with reference to the SOP manual itself rather
than the brief's summary. Read `docs/sop/2026-11-17_JSS_SOP-Manual-v2.md` in full against the
live schema (37 tables, 11 views, 17 stages, 8 roles) and recorded the result as a coverage
map: the 7 rules, all 23 flowchart steps, PMS, IMS, PC/Help Tickets, MIS scores, the 6 company
KPIs and all 11 appendix checklists.

Findings that changed the plan:

- The 23 steps are **one mechanism, not three features**, and `working_minutes_between()`
  from 0047 is already its TAT engine.
- **No table in the schema stores a reason.** `audit_log` holds who/what/before/after but not
  why. Rules 2, 3, 4 and 7 each require a logged reasoned override — one `override_log`, built
  before any of them.
- **`purchase_order` is the client's PO; the SOP's Purchase flowchart is a supplier order.**
  No supplier-order entity exists. Flagged so nobody overloads the client table.
- **Five of the six company KPIs cannot be computed today** — only OTD can. Wastage is
  captured but optional, so it is unmeasurable.
- `dispatch.eway_bill_no` already exists (D2C 1 is half-built); Busy bill no. and bill date
  do not.

## 18-Nov-2026 — manual job close (migration 0048)

**Tables:** `po_item` + 3 columns (`closed_manually_at`, `closed_by`, `close_reason`),
2 CHECKs, 1 index, 1 `app_setting` row, 3 new triggers, `recompute_po_item_status` replaced
with a superset of itself.
**Files:** `drizzle/0048_manual_job_close.sql`, `drizzle/meta/_journal.json`,
`src/db/schema/order.ts`, `src/db/audit.ts`, `src/auth/roles.ts`,
`src/modules/purchase-orders/{actions,queries,validation}.ts`,
`src/components/purchase-orders/po-controls.tsx`,
`src/app/(app)/purchase-orders/[id]/items/[itemId]/page.tsx`,
`tests/manual-close.test.ts`, `docs/DECISIONS.md` (section X).

Asked for by Utkarsh: a job that will never be finished can be closed by hand, by ADMIN,
DATA_ENTRY_FULL and OWNER only, no earlier than 30 days after its PO date, with a required
reason recorded against the person's name. Closed ≠ Cancelled — see X1.

Two things worth carrying forward:

- **The recompute would have un-closed it overnight** (X2). `status` is derived and
  recomputed from dispatch quantities nightly; it returned early for `'Cancelled'` and
  nothing else. The close is stored as a fact the recompute now reads, so `status` stays
  derived rather than becoming stored.
- **The tests found a missing trigger** (X3). A draft had the server action call the
  recompute itself; every test asserting on the three columns passed and six asserting on
  the resulting *status* failed. Asserting the derived answer rather than the stored input
  is what caught it.

**Open and unsettled:** `v_otd` still excludes a manually closed job with a shortfall, so
closing an old late job improves OTD without a delivery changing (X7). Fenced and attributed
meanwhile; nothing has been closed, so OTD is unchanged by the migration.

Dev only. 22 new tests pass. Not committed, not pushed, production untouched.

## 19-Nov-2026 — ups on the job card (migration 0049)

**Tables:** `job_card` + `ups integer`, 1 CHECK. **Files:** `drizzle/0049_job_card_ups.sql`,
`_journal.json`, `src/db/schema/production.ts`, `src/modules/job-cards/{paper,validation,
actions,queries}.ts`, `src/components/job-cards/{paper-quantity,paper-sheet-figures,
job-card-form}.tsx`, `src/app/(app)/job-cards/[id]/page.tsx`,
`src/app/(print)/job-cards/[id]/print/page.tsx`, `tests/{paper-count,job-card}.test.ts`,
`docs/DECISIONS.md` (section Y).

Completes the sheet chain: parent sheets → press sheets → **pieces**. Null means not
recorded, never single-up (Y2).

The data model settled three design questions on its own (Y3): ups is not a sheet fact, so
it is absent from `resolvedSheet()`, absent from `press_run`, and deliberately *not* shared
across a bulk release — four cartons on one plate have four different ups. A shared ups box
on the gang form was built and reverted for that reason.

Also reverted before shipping: a "short of the order" warning, which would have fired on
every deliberately split run (Y5).

Dev only. 13 new tests; `paper-count` 28/28, `job-card` 35/35.

## 19-Nov-2026 — job work (migration 0050)

**Tables:** `purchase_order` + `is_job_work boolean NOT NULL DEFAULT false`;
`v_po_item_status` replaced in place (po_awaited expression changed, `is_job_work` appended).
**Files:** `drizzle/0050_job_work.sql`, `_journal.json`, `src/db/schema/order.ts`,
`src/db/views.ts`, `src/modules/purchase-orders/{queries,validation,actions}.ts`,
`src/components/purchase-orders/{po-form,po-controls,po-awaited}.tsx`,
`src/app/(app)/purchase-orders/[id]/page.tsx`, `tests/job-work.test.ts`,
`docs/DECISIONS.md` (section Z).

Job work is an ORDER, not a card floating free (Z1) — `job_card_item.po_item_id` is NOT NULL
and `po_item` is the spine, and SOP Rule 1 says every job including job work is opened in MIS.
So it gets a job number and an ordinary job card; nothing about the card changed.

What was actually missing was not a label (Z2): `po_awaited` means "go and fetch the PO", and
for job work none is coming — so a job-work order would have nagged for a document that does
not exist, forever. The fix is in the `po_awaited` expression, in both places that hold it.

`CREATE OR REPLACE` with the new column last, so `v_otd`, `v_wip_ageing` and
`v_client_summary` were never dropped (Z4); all four verified resolving afterwards.

One trap caught (Z6): the header edit form posts the whole header, so without the box
carrying the stored value, saving any other field would have silently un-marked a job-work
order.

Dev only. 8 new tests pass. Not committed, production untouched.

## 19-Nov-2026 — job work pre-selects Party for paper (section Z9)

**Tables:** none. **Files:** `src/modules/job-cards/supply.ts` (new),
`src/components/job-cards/job-card-form.tsx`, `src/modules/items/queries.ts`,
`src/modules/job-cards/queries.ts`, `src/app/(app)/items/[id]/page.tsx`,
`src/app/(app)/job-cards/new/page.tsx`, `tests/job-work.test.ts`, `docs/DECISIONS.md`.

Asked for by Utkarsh after Z7 had left it out. `SupplySelect` carried a standing argument
against defaulting this field; that objection is about guessing without information, and job
work supplies the information. The exception is now written beside the rule in that component
rather than contradicting it silently.

The rule is a pure function so it can be tested: a stored answer always wins, releasing for
job work offers Party with a hint, everything else is blank. **`mode` is load-bearing** — on
an existing job-work card with no supply recorded, defaulting would write Party into a column
nobody answered when any other field was saved, which is the backfill W1 and Y2 refuse,
arriving through a form instead of a migration.

`plateSupplyBy` stays blank: sending board says nothing about who makes the plate.

Dev only. 5 new tests; job-work 13/13.

## 19-Nov-2026 — OTD sees a job closed by hand (migration 0051)

**Tables:** none. **Views:** `v_po_item_status` + `closed_manually_at` (appended last);
`v_otd` expressions and WHERE changed, columns identical.
**Files:** `drizzle/0051_otd_sees_manual_close.sql`, `_journal.json`, `src/db/views.ts`,
`tests/manual-close.test.ts`, `docs/DECISIONS.md` (section AA; X7 corrected in place).

**X7 was wrong and section AA says so.** A manually closed job did not disappear from OTD —
0043 had already added `OR status = 'Closed'`, which I missed by reading 0002's definition
of the view instead of its newest. The real faults were narrower and both *flattered* the
number: a job closed with nothing dispatched was absent (the genuine exploit), and a short
delivery could score as **on time**. A merely late job was never helped by closing it.

Now: a short close is admitted whether or not anything shipped, is never on time, and is
dated the day it was closed — "the date the order stopped being owed", which is the same
definition a completed item already used.

T1's auto-close keeps its scoring exactly (AA3). The acceptance check holds by construction,
not by luck: every new term is guarded by `closed_manually_at IS NOT NULL` and no row has it
set (AA5).

Dev only. 7 new tests; manual-close 29/29. One of them demonstrates the old bug live — the
short close reads on_time true before the close and false after.

## 20-Nov-2026 — W–AA promoted to production, and a way back

**Database:** migrations 0047–0051 applied to the production Neon branch
(`ep-wispy-dawn`), taking it from 47 applied to 52. Additive only: 8 new nullable columns
(one `NOT NULL DEFAULT false`), 4 functions, 3 triggers, 1 new view, 2 views replaced in
place, 5 new `app_setting` rows. No existing row updated or deleted; `audit_log` unchanged at
5,325 rows.

**Files:** `drizzle/down/` (5 down files + README), `scripts/migrate-down.ts`,
`src/app/api/health/route.ts` (expectations for 0041–0051),
`docs/DECISIONS.md` (section BB), `docs/DEPLOYMENT.md`.

**Why down migrations existed first.** Rule 7 of the brief requires a reversible migration
and there were none in the repo — drizzle-kit applies forward only. `scripts/migrate-down.ts`
runs a down file and deletes the matching journal row in one transaction, because doing only
the first leaves a database `db:migrate` reports as up to date while the columns are gone
(BB1).

**The promotion was rehearsed on production and rolled back.** All five ups, then all five
downs, in one transaction against real production data. Result: ten views identical on the
columns they already had, `v_otd` 49 of 100 before and after, no row written, and a schema
after the downs that was byte-identical across 731 columns, 503 constraints, 148 indexes, 20
functions, 35 triggers, 10 views, 31 enum types and 4 settings (BB5).

**One thing needed explaining.** `v_wip_ageing`'s checksum had moved after the real run. Its
definition is byte-identical; `hours_in_stage` is derived from `now()`, so the checksum moves
every few seconds on its own (BB6).

**The health endpoint had stopped checking at 0040** — eleven migrations behind, so production
would have called itself up to date while missing all of W–AA. Fixed to 0051 (BB7).

Verified before applying: `tsc` clean, `eslint src` clean, 59 test files / 776 tests passing.

**Not deployed.** `origin/main` is still a commit behind; the code has not been pushed. That
is the correct order for an additive batch and nothing in the running build reads the new
columns (BB8).
