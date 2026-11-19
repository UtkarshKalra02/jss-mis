You are working on the JSS The Print Zone MIS — a delivery-performance system for a commercial offset printing and packaging factory. It is live in production and used daily by staff. Your job is to extend it so it supports the company's new operating SOPs (BMP framework), without touching production until each change is proven.
0. Hard safety rules — read first, follow always

1. Do not modify production. No migrations, deploys, seed scripts, or writes against the production database or production hosting. If you find production credentials in env files, do not use them; tell me.
2. Work in a separate project:
   * a new git branch `sop-v2` in a new git worktree (not the main working copy);
   * a separate database (a new staging project/instance of whatever we use today), loaded from a production snapshot I will provide or that you script as a read-only dump. Write the exact commands in `docs/sop-v2/STAGING.md` and ask me before running anything that reads production.
   * a separate deploy target (staging URL) if hosting allows.
3. Preserve the four invariants exactly as they are:
   * current stage is derived from the latest stage event, never stored;
   * pending quantity = ordered − dispatched, computed, never stored;
   * status is derived by trigger; only the two existing functions may write it;
   * every write goes through the audit wrapper; no hard deletes ever; soft deletes leave a trail. Every new table follows the same rules (audited writes, no hard delete, derived values in views not columns).
4. Nothing is deleted. Modules we stop using are hidden behind feature flags / role permissions, not dropped. Their tables and data stay.
5. Busy stays the book of record for money. Do not build accounting, GST, e-way bills, invoices, receipts or AR ledgers. Store only references (e.g. a Busy bill number on a challan) and dates.
6. Plan first, then wait. Your first deliverable is a plan (section 5). Do not write code until I approve it.
7. Promotion to production only after: all tests pass on staging, the acceptance checks in section 4 pass on the production snapshot, a reversible migration exists (up and down), and I say "promote" for that specific phase. Never promote more than one phase at once.

1. Read before planning

* `docs/` — the spec, the decisions log and the backlog.
* `docs/sop/SOP-Manual-v2.md` — the operating SOP the system must now support. Sections 4 (7 rules), 5 (three flowcharts: O2D, Purchase, D2C — each step has WHAT/WHO/HOW/WHEN), 6 (PMS daily planning), 8 (Process Coordinator + Help Tickets), 9 (MIS scores, Delegation Sheet, KPIs), 11 (rollout phases) and the Appendix checklists are the requirements.
* The current schema, the 10 views, the 17 stages, the 8 roles.

People and roles the SOP assumes (map them to existing roles; propose changes only if needed): Amit Sir (owner, pricing, paper purchase, final authority) · Utkarsh (Operations Head, runs daily planning) · Anushka (Process Coordinator & MIS — follows up every step, raises Help Tickets) · Preeti (planning & dispatch coordinator: full-kit check, job cards, die-cut board, receiving, packing slip, dispatch) · Puneet (prepress: artwork, plates/dies/positives/foil, first-sheet colour sign) · Ajay (production in-charge: floor, changeovers, packing check sign) · Pradeep (accounts: bills, collections — in Busy).
2. Step 1 — diagnose the data before adding features
The system currently reports: 101 open items, 79 overdue, OTD 18.2% (8 of 44), 68 of 99 open items with a stage older than 14 days, and an auto-close rule that wrote off 3,340 pcs across 4 items in two weeks (3 still showing a floor stage). Committed dates are typed manually with no check.
On the staging snapshot, produce `docs/sop-v2/DATA-AUDIT.md` answering:

1. Of the 68 stale items: how many are really finished/dispatched, how many genuinely stuck, how many abandoned? Give a list I can hand to staff to confirm.
2. The auto-close rule: exact logic, the 4 affected items, whether each write-off was correct. Propose a fix (e.g. never auto-close an item with a stage event in the last N days; require a reason and a user).
3. Committed dates: distribution of (committed − PO/approval date). How many were < 14 days? Is the 18.2% measuring the factory or the promises?
4. Any other integrity issue you find (items without a PO older than X days, challans without stage events, etc.).

Do not "fix" production data. Propose a cleanup script that runs on staging, and a one-page cleanup checklist for staff.
3. What to build — by rollout phase
Reuse existing modules wherever possible. "Unused" modules (Job kitting, Delegation) should be repurposed, not rebuilt.
Phase 1 (needed first — supports O2D + daily planning)
1.1 Job opening discipline (Rule 1: no job number, no machine; O2D steps 1–2)

* On a PO item (and "item before PO"): capture `confirmation_source` (PO / WhatsApp / verbal), `confirmed_by` (user), `confirmed_at`, and `opened_at` (system).
* Metric: % of items opened within 2 working hours of confirmation; list of items that reached a production stage without being opened first (should be zero).

1.2 O2D step tracking (planned vs actual) — the core addition

* New table for flow step events separate from the 17 floor stages: for each PO item, the 10 O2D steps from the SOP, each with owner role, `planned_at` (computed from the trigger step + TAT from the SOP's WHEN column, using working hours/days — make TATs configurable in Admin), `done_at`, `done_by`.
* Map existing stage events to O2D steps where they already exist; only ask staff to record what is missing (artwork sent, approval received, consumables ordered/received, full-kit done, packing check).
* Approval date becomes the start of the 14-day promise: suggest committed date = approval date + 14 days (editable, but log every override with a reason).
* View `v_flow_step_status`: per step — pending / done on time / done late / overdue.

1.3 Full kit (Rule 2) — repurpose the Job kitting module

* Per item, a 5-point full-kit check: job no., approved artwork, plates & die received, paper issued, foil block (if needed). Each point ticked with user + time.
* An item cannot be added to the day plan unless full kit = complete (allow override by Utkarsh / Amit Sir only, logged).

1.4 Daily planning (PMS) around the bottleneck (Rules 3–4)

* Extend Job planning: a die-cut board with three lanes (Auto / Manual 1 / Manual 2) and a daily sequence.
* Plan vs Actual at two checkpoints (1 pm, 5 pm): planned qty vs actual per machine.
* Urgent insertion log: only Amit Sir / Utkarsh roles can insert; record who inserted, which job, and which job was pushed. Never allow re-planning a job marked "running".
* Job card fields for each die-cut changeover: setting start, setting end, sheets run, sheets wasted. (This finally gives honest makeready and wastage data.)
* Printable floor plan in English and Hindi already exists — extend it to show the die-cut board.

1.5 Process Coordinator (PC) list + Help Tickets

* PC screen for Anushka: all flow steps due today or late, grouped by owner, with a one-tap "reminded at" log. Designed for her two rounds (11:00, 15:30).
* Help Tickets module: date, raised by, item & step, stuck with (person), problem, three proposed solutions (required), problem solver, due date, status, closed date, resolution. View for open/overdue tickets.

1.6 Dashboard additions (owner + Utkarsh): today's die-cut board, full-kit-blocked items, open Help Tickets, items opened late, urgent insertions this week.
Phase 2 (Purchase + D2C + quality gates)
2.1 Paper request → order → receive (Purchase flowchart)

* Paper request entity linked to job no.: board type, GSM, size, qty incl. wastage, required-by date, raised by. Amit Sir marks "ordered" (with supplier, date) — target within 1 working day. Receiving links the existing GRN to the request, with a 5-point receiving check (Preeti). Mismatch → auto-create Help Ticket.

2.2 IMS for top boards

* On the 10 highest-consumption boards: max level = daily use × lead time × safety factor (configurable); zones RED (below reorder) / PURPLE (above max) using existing stock views. Reuse `v_material_stock`; don't duplicate.

2.3 Quality gates as hard checks (Rule 7)

* First-sheet colour sign (Puneet) required before a print stage is marked running.
* 5-point packing check sign (Ajay) required before a challan can be finalised. No check, no dispatch.
* Simple complaints log: item, date, type (colour / damage / count / other), action. No full rejection/rework module.

2.4 D2C — references only, no accounting

* On each challan: Busy bill number, e-way bill number (optional), bill date. Report: challans without a bill number (should be zero) — used for the weekly gate-register audit.
* Payment follow-up: per bill, payment due date and follow-up dates/notes (Pradeep). No amounts ledger beyond what already exists in the dashboard.

Phase 3 (scores and accountability)
3.1 Negative MIS score per person per week

* Score = −(planned − done on time) / planned × 100, computed from flow step events and checklist items owned by that person. View `v_mis_score_weekly`. Weekly report for the Monday meeting.

3.2 Align the Delegation module to the SOP

* SOP uses BMP levels 1–4; the module has an L2–L5 ladder. Propose a mapping (do not silently change semantics). Delegation score = on-time completion of delegated tasks.
* Appraisal view: 80% MIS score + 20% Delegation score, quarterly.

Hide (feature flag / permissions — do not delete)

* Designs (0 rows), Enquiries and Quotations (1 row; pricing stays with Amit Sir), Invoices / Receipts / AR (`v_ar_ageing` — Busy owns money). Keep tables and data.

Do not build
Accounting, GST, payroll/HR, labour management, CRM/sales automation, BOM/MRP, a full quality department, a digital gate register (the guard keeps paper registers; the system only needs the bill-number-on-challan report).
4. Acceptance checks (run on the production snapshot in staging)

* All existing screens show the same numbers before and after migration for unchanged data (write a diff test against the 10 views).
* OTD in `v_otd` is unchanged by the migration itself.
* No existing row is updated or deleted by any migration; all new writes appear in the audit table.
* Every new screen used on the floor works on a phone at 360 px width; Hindi labels where floor staff use it (Ajay, operators).
* A dry-run of one full job through O2D steps 1–10 on staging produces correct planned/actual timestamps and correct late flags.
* Down-migration restores the previous schema cleanly.

5. Your first reply — the plan (no code yet)
Give me:

1. Your reading of the current architecture in 10 lines (stack, DB, hosting, how audit/triggers work).
2. The staging setup you propose and the exact commands (I approve before you run).
3. For each item in section 3: tables/columns/views/screens to add or change, which existing module it reuses, the migration risk (low/med/high), and effort (S/M/L).
4. Anything in my SOP that conflicts with how the system works today, with your recommendation.
5. The order you'd build Phase 1 in, so the most useful piece (1.2 + 1.5) is on staging first.

Keep a `docs/sop-v2/CHANGELOG.md` with date (DD-MMM-YYYY), files/tables touched and why.