# Backlog

Requirements captured from Utkarsh that are not yet built, recorded here so they survive
between working sessions. When something here is built, it moves into
[`DECISIONS.md`](DECISIONS.md) as a decision with a code, and the entry below is struck
out rather than deleted — the requirement is the thing the decision has to answer to.

---

## ~~Excel/CSV importer (Phase 2)~~ — BUILT

Captured verbatim, 18 Aug 2026. Built in chunk 10; see decisions F28–F31 in
[`DECISIONS.md`](DECISIONS.md). The requirement is kept in full below, struck through in the
heading rather than deleted, because it is what the decisions answer to.

**One line of it was amended on 25 Aug 2026 and no longer describes what is built.** The
"unmatched names are REJECTED — never auto-create" validation was refusing whole files over
"NATUREEXPERT AYURVEDIC PVT LTD" versus "Natureexpert Ayurvedic". Matching is now tolerant,
creation is allowed where nothing on file resembles the name, and a name that resembles one
goes to a per-row decision instead of being refused. The original wording is left in place
below, because the amendment is only legible against what it replaced. See **F32**.

> Purpose: bulk entry of ~40 historical completed jobs from paper books,
> and later batch catch-up by a data-entry person. NOT the primary entry
> path — the forms are.
>
> Build as a SCREEN, not a CLI script. A non-technical person will use it.
>
> - Downloadable .xlsx template: exact columns needed, one example row,
>   locked header row.
> - One row = one job: client name, PO no, PO date, item name, ordered qty,
>   rate, committed date (may be blank), dispatch date, dispatched qty,
>   challan no.
> - Upload -> parse -> VALIDATION PREVIEW SCREEN before anything is
>   written. Row-by-row status: OK / warning / error, with the specific
>   reason per row.
> - Errors block that row only, never the whole file. Show a count summary.
> - Validations: client exists (unmatched names are REJECTED with an
>   offer to create — never auto-create), dates parse as DD/MM/YYYY,
>   qty is a positive integer, dispatched qty <= ordered qty, duplicate
>   detection on client + PO no + item name.
> - On confirm: creates purchase_order, po_item, dispatch, dispatch_line
>   and stage_events in ONE transaction.
> - Every row attributed to the logged-in user in audit_log, plus an
>   import_batch_id so a bad batch can be identified and reversed.
> - Blank committed_date is allowed and flagged — those jobs count toward
>   lead time but are EXCLUDED from OTD.
> - "Import History" list: batch, date, user, rows imported, undo action.
>
> Historical rows get a MINIMAL stage history, not a full invented one:
> PO_RECEIVED at po_date, DISPATCHED at dispatch_date. Nothing in between.
> Do not fabricate intermediate stages.
>
> Dedupe key on re-run: client + PO no + item name. Match = skip with a
> warning, never overwrite.

### Consequences that fall out of the above

These are not new requirements. They are what the requirements force, written down so
they are not rediscovered mid-build.

**`committed_date` becomes nullable.** Settled as decision F8: the column becomes
nullable, the PO capture form keeps requiring it with no exceptions, the importer is the
only path allowed to write null, `v_otd` excludes those rows entirely, and every screen
renders them as "Historical — no commitment recorded" rather than as a blank cell. Spec
section 10 was amended to match. This is the one place Phase 2 relaxes a non-negotiable,
and it is a deliberate, narrow exception rather than a drift.

**Undo cannot delete stage events.** `stage_event` is append-only, enforced by a database
trigger, so reversing a batch cannot remove the events it wrote. Undo therefore
soft-deletes the `po_item` rows, which removes them from `v_po_item_status` and every view
built on it — the events remain in the table, attached to rows nothing displays. That is
the correct outcome rather than a workaround: the history of what was entered and then
withdrawn is exactly what an audit trail is for.

**A new dependency is needed to write .xlsx.** The template has a locked header row, which
means generating a real workbook, not a CSV with a different extension. The stack is fixed
but says nothing about file parsing; this needs explicit approval before it is added.


---

## ~~Delegation module (BMP Week 9)~~ — BUILT

Captured 25 Aug 2026. Built the same day; see decisions **G1–G9** in
[`DECISIONS.md`](DECISIONS.md). The first module in the system that the v1 spec does not
describe at all — it comes from the Business Mastery Program and is orthogonal to the six
build phases rather than jumping ahead of them.

> A weekly accountability layer for ONE-TIME tasks. It is NOT a to-do list and
> NOT for recurring work.
>
> - `delegation_task`: assigned_to, assigned_by, task, level L2/L3/L4,
>   date_given, expected_date (NOT NULL — a task without a date is not
>   delegated), status, completed_at, blocker_note.
> - DELIBERATELY NO recurrence field. Recurring work belongs on a checklist.
> - Derived, never stored: days_late, is_overdue, and a per-person scorecard.
> - My Tasks: the assignee may ONLY change status, completed_at and
>   blocker_note. Done requires completed_at; Blocked requires blocker_note.
>   Enforced server-side, not just in the form.
> - Delegate: task text and expected_date editable ONLY by assigned_by or
>   ADMIN. The assignee cannot move their own goalposts.
> - Scorecard: the Executive Meeting screen. Large, legible, no interaction.
> - Dashboard card: "You have N overdue tasks".
> - Reassignment must leave an audit trail showing both people. Scores must not
>   be launderable by moving a late task.
> - Roles: everyone gets My Tasks. ADMIN delegates to anyone, non-admins only
>   to themselves. Scorecard = ADMIN and OWNER.

### Two holes the requirement did not cover

Not new requirements — things the requirements force, found while building and settled
rather than left.

**Cancelling was a laundering route.** The assignee may change `status`, and `Cancelled` is
a status. Excluding cancelled tasks from the score would then let anybody cancel what they
were about to miss and reach 100%; including them would punish somebody for work genuinely
withdrawn from them. Resolved as G3: only the delegator or ADMIN may cancel, and cancelled
tasks are then safely excluded. The two halves only hold together.

**The OWNER conflict was real and is now a documented exception to B2, not a softening of
it.** Decision G2: OWNER may UPDATE `status`, `completed_at` and `blocker_note` on
`delegation_task` rows already assigned to him, and nothing else anywhere. A second account
was rejected as the *wider* grant despite looking safer. Eleven tests, eight negative, pin
the boundary.

---

## Removing a record 404s the screen it was removed from

Found 25 Aug 2026 while fixing the same bug in Delegation (decision G11). **Not yet fixed
on these three screens.**

`/clients/[id]`, `/designs/[id]` and `/admin/users/[id]` each call `notFound()` when their
record is missing, and each has a Remove button whose action soft-deletes the record and
returns `ok()` with no redirect. The record then leaves the query the page reads, so the
confirmation for removing something is a 404.

The fix is the one already applied in `src/modules/delegation/actions.ts`: return
`ok(message, "/clients")` from the delete action and push to it from the control component,
following the `redirectTo` convention the design, PO and dispatch forms already use. Do NOT
call next/navigation's `redirect()` inside the action — it works by throwing and every one
of these actions has a try/catch that would report the successful removal as a failure.

Left out of the delegation fix on purpose: three more screens in a bugfix commit is a
bigger review than the bug deserves, and none of them is new.

---

## ~~Press run grouping (ganged jobs)~~ — BUILT

Captured 26 Aug 2026, built the same day; see decisions **H1–H7** in
[`DECISIONS.md`](DECISIONS.md).

> Roughly 3-8 jobs a month are "ganged" — items from DIFFERENT clients printed
> together on one plate to fill a sheet. Today the system cannot represent this
> at all, so the item tracker implies each ran standalone, which is false.
>
> Does NOT reverse the one-item-per-job-card rule. job_card.po_item_id stays
> exactly as it is. Ganging is a grouping ABOVE job cards, not a loosening
> below them.
>
> - press_run: run_no (FY series, prefix PR), run_date, machine (free text),
>   notes. job_card gets a NULLABLE press_run_id.
> - Deliberately out of scope: cost splitting, shared scheduling/capacity, and
>   any constraint that ganged cards share a stage or move together.
> - Screens: "Add to press run" from the job card; a press run detail view
>   where cross-client is normal and must not warn; a "Ganged with 2 others"
>   badge in the Item Tracker.
> - No sidebar entry, no list screen, no reports.
> - ADMIN and PLANNER create and edit; everyone with the Item Tracker sees the
>   badge.

### What is still blocked

**The feature is inert until Phase 4.** Nothing in the application creates a job card —
every reference to `job_card` is a read, and `getItemJobCards` says so itself. So there is
nothing to gang yet. The schema, the run screen, the badge and the actions are all built and
tested; they light up when the Phase 4 planning board starts creating job cards.

Because there is no job card screen, "Add to press run" was placed in the Item Tracker's job
cards panel (decision H6). When the planning board arrives, it should call the same server
actions in `src/modules/press-runs/actions.ts` rather than growing its own.

---

## ~~Tooling register~~ — BUILT

Captured 27 Aug 2026, built the same day; see decisions **I1–I9** in
[`DECISIONS.md`](DECISIONS.md).

> Tracks the physical tooling the factory owns. Punit (ORDER_DESK) owns it.
>
> - Four types in ONE table with a discriminator: PLATE, FOIL_BLOCK, DIE,
>   EMBOSS_BLOCK. Not four near-identical tables.
> - tool_no from the FY series, prefix per type (PLT, FBL, DIE, EMB).
>   location NOT NULL and prominent everywhere — the most-used field.
>   replaces_tool_id for old/new versions of the same tooling.
> - Migrate design.die_id / plate_id / die_status / plate_status into tooling,
>   then DROP them. Do not leave both. Migration has a dry-run.
> - Screens: searchable/filterable register, add/edit, detail with the
>   replacement chain, and the tooling attached to a design on the design
>   screen.
> - NO issue/return workflow. Status is set manually.
> - ORDER_DESK and ADMIN write. Everyone else read-only. FLOOR gets read-only
>   search on mobile.

### Still to run against production

The design-column migration is a **three-step sequence** and the steps are not
interchangeable (I7):

```bash
npm run db:migrate                              # 0014, 0015 — create tooling
DOTENV_CONFIG_PATH=.env.production.local npm run migrate:tooling          # dry run
DOTENV_CONFIG_PATH=.env.production.local npm run migrate:tooling -- --apply
npm run db:migrate                              # 0016 — drop the four columns
```

Migration 0016 refuses to run until the script has been applied, so a plain `db:migrate`
cannot drop the data early. Verified in both directions against a real database.

Every migrated row lands with `location = "Not recorded — please update"`. Search the
register for that phrase and fill them in from the shelf — until that is done, the register
knows what tooling exists but not where any of it is.

### Known limit, deliberately not built

A tool belongs to at most ONE design (`design_id` is a single nullable FK, as specified).
Tooling genuinely shared between designs cannot be expressed and would need a junction
table. The detail screen therefore shows one design where the requirement said "which
designs use it".
