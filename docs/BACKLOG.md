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

## ~~Removing a record 404s the screen it was removed from~~ — FIXED TWICE

Found 25 Aug 2026 while fixing the same bug in Delegation (decision G11). **Fixed on 2 Sep
2026, on FOUR screens rather than three** — a fourth instance turned up when the bug was
reported from use.

`/clients/[id]`, `/designs/[id]`, `/admin/users/[id]` and
`/purchase-orders/[id]/items/[itemId]` each call `notFound()` when their record is missing,
and each had a Remove button whose action soft-deleted the record and returned `ok()` with
no redirect. The record then left the query the page reads, so the confirmation for
removing something was a 404.

**The fourth one was not in this list and is worth noting**, because it is why "three
screens" was the wrong count: `removePoItemAction` is reachable from the PO item's own
detail page, not only from the order. Removing an item while standing on
`/purchase-orders/[id]/items/[itemId]` had exactly the same failure, and nobody had walked
that path. The lesson is that the audit for this bug is "which actions soft-delete a row
that some page reads by id", not "which detail screens have a Remove button".

Cancelling deliberately does NOT redirect anywhere. A cancelled item, PO or challan is
still there and still worth looking at; only removal makes the page unreadable.

**The 2 Sep fix did not work, and the bug was reported again on 3 Sep.** Returning a
destination for a `useEffect` to push to loses a race against the server action's own
re-render of the current route — the page calls `notFound()` and React commits that before
the effect runs. The real fix is a server `redirect()` with `unstable_rethrow` in the
catch, applied to all eight remove actions. See **J13**, which supersedes G11's prescription
while keeping its diagnosis.

The fix is the one already applied in `src/modules/delegation/actions.ts`: return
`ok(message, "/clients")` from the delete action and push to it from the control component,
following the `redirectTo` convention the design, PO and dispatch forms already use. Do NOT
call next/navigation's `redirect()` inside the action — it works by throwing and every one
of these actions has a try/catch that would report the successful removal as a failure.

Left out of the delegation fix on purpose at the time: three more screens in a bugfix
commit was a bigger review than the bug deserved, and none of them was new. That judgement
turned out to cost a real 404 in use, which is the argument for taking the whole class next
time rather than the instance in front of you.

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

## ~~Tooling register~~ (now "Job Kitting") — BUILT

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


---

## The kitting gate — NOT BUILT, and not what "Job Kitting" is

Captured 2 Sep 2026, alongside the rename recorded as **I10** in
[`DECISIONS.md`](DECISIONS.md). Written down the same day the register was renamed,
precisely because the shared word is what would otherwise get this ticked off as done.

The Business Mastery Program's **kitting gate** is a readiness check run against ONE JOB
before it starts:

> Are material, plate, die and artwork all ready? If any one of them is not, the job does
> not go to the floor.

That is a checklist tied to a `job_card` — answered once per job, on a specific day, with
a go/no-go outcome. It is **not** the register now labelled Job Kitting, which is a
permanent inventory of physical tooling answering "where is the die kept". The two share a
word and nothing else.

Not built, and not to be built as a side effect of anything else. When it is built it
should be:

- a checklist against `job_card`, not against `tooling` and not against `po_item`;
- capable of blocking or warning at release (J1), which is the only point in the system
  where a job is declared ready to go to the floor;
- honest about material, which the system cannot see at all today — see the IMS entry
  below. A gate that ticks "material ready" from nothing but somebody's say-so is a gate
  in name only, and the register cannot supply that half of the answer.

---

## IMS — inventory management, board / ink / foil stock

Captured 2 Sep 2026, verbatim:

> IMS (inventory management — board, ink, foil stock) is a future need. Out of scope until
> the costing engine and the real kitting gate exist, since IMS without job-linked material
> issue just becomes another unmaintained stock count.

Spec section 1 already puts "Inventory / material stock" out of scope for v1, so this is
not a new exclusion — it is the reason the exclusion should hold, recorded so that the next
person to want a stock screen finds the argument rather than re-running it.

The dependency is the load-bearing part. A stock count that nothing decrements is a number
that is right on the day it is typed and wrong every day after, and it looks exactly as
authoritative on both — the same failure mode I5 refused for tooling issue/return, and A2
flagged for the unmeasured stage targets.
