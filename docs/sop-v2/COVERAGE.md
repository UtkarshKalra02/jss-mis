# SOP v2 → MIS coverage map

What `docs/sop/2026-11-17_JSS_SOP-Manual-v2.md` requires, against what the schema actually
has. Written 18-Nov-2026 by reading the schema, not the brief's summary of it.

Legend: **✅ built** · **◐ partial** (something exists, reusable, incomplete) · **✗ nothing**

---

## 0. The shape of the gap, in one paragraph

The SOP needs **five new tables, one new enum value, and about twenty fields on tables that
already exist.** It is not a rewrite. The largest single piece is not a feature at all — it
is the realisation that the three flowcharts (O2D 10 steps, Purchase 7, D2C 6 = **23 steps**)
are one mechanism, not three: every step has a WHAT / WHO / HOW / WHEN, and WHEN is a TAT in
working hours from a trigger step. **Migration 0047 already built that engine** —
`working_minutes_between()` plus configurable thresholds in `app_setting` — for the 2-hour
job-opening rule. Twenty-three steps reuse it unchanged.

---

## 1. The 7 JSS Rules (section 4)

| # | Rule | State | What is missing |
|---|---|---|---|
| 1 | No job number, no machine | **✅** | Built 18-Nov (0047): `confirmation_source`, `confirmed_by`, `confirmed_at`, 2-working-hour metric, dashboard tile. Measured, not enforced. |
| 2 | Full kit before planning | **◐** | `job_card.checklist_paper / _plates / _colour` — 3 ticks, no user, no time, **not enforced** (J11). SOP wants 5 points (adds approved artwork, foil block), each with who + when, and a hard block on planning. |
| 3 | Plan from die-cut backwards | **◐** | `plan_entry` has `plan_date`, `machine_id`, `sequence`, `planned_qty`. No lanes (Auto / Manual 1 / Manual 2), no "next die staged" check, no backward scheduling. |
| 4 | Urgent jobs by rule | **✗** | No insertion log, no "which job was pushed", and **no `running` state to refuse re-planning against**. |
| 5 | Prepress deadlines (24 h artwork, 24 h consumables) | **✗** | `DESIGN` and `APPROVED` stages exist, but no artwork-sent date, no consumables ordered/received dates. |
| 6 | Paper in writing, checked on arrival | **✗** | No paper-request entity at all. `grn` exists for receiving but has no 5-point check. |
| 7 | Two simple checks (first sheet, packing) | **✗** | `checklist_colour` is a tick on the job card, not Puneet's signature. No packing check. Neither gates anything. |

---

## 2. The three flowcharts (section 5) — 23 steps

**O2D (5.1)**

| # | WHAT | Existing | Gap |
|---|---|---|---|
| 1 | Order confirmation reaches Anushka | **✅** | `confirmation_source` incl. WhatsApp (0047) |
| 2 | Job opened in MIS + paper request raised | **◐** | opening ✅; **paper request ✗** |
| 3 | Artwork set and sent for approval | **◐** | `DESIGN` stage event; no `artwork_sent_at`, no A2 checklist |
| 4 | Approval received — **14-day promise starts** | **◐** | `APPROVED` stage event ✅. `committed_date_basis` already carries an unused `Calculated` value reserved for exactly this. Not wired. |
| 5 | Plates, die, positives, foil ordered + received | **◐** | `tooling` holds dies; no per-job ordered/expected/received dates, no A3 checklist |
| 6 | Full-kit check | **◐** | see Rule 2 |
| 7 | Planned in PMS; job card issued | **✅/◐** | `plan_entry` + `job_card` both exist; die-cut board missing |
| 8 | Production + first-sheet colour sign | **◐** | 17 stage events ✅; colour sign ✗ |
| 9 | Count, packing slip, 5-point packing check | **◐** | `dispatch` + `dispatch_line` ✅; 5-point check ✗ |
| 10 | Dispatch; MIS updated; client informed | **◐** | `DISPATCHED` ✅; "client informed" not recorded |

**Purchase (5.2) — the biggest hole**

> **A naming trap worth stating plainly: `purchase_order` is the *client's* PO.** The SOP's
> Purchase flowchart is a *supplier* order. **There is no supplier-order entity in the
> schema at all.** Do not overload `purchase_order` for it.

| # | WHAT | Existing | Gap |
|---|---|---|---|
| 1 | Stock checked for the job's board | **◐** | `v_material_stock`, `v_material_batch_stock` ✅ reusable |
| 2 | Paper request to Amit Sir (A7) | **✗** | new table |
| 3 | Order placed with supplier | **✗** | new; no supplier order anywhere |
| 4 | Order logged; supplier followed up | **✗** | new |
| 5 | Delivery checked (A8, 5 points) | **◐** | `grn` ✅; check ✗ |
| 6 | Shortage → Help Ticket + photo | **✗** | no tickets, no attachments |
| 7 | Stock updated, linked to job | **✅** | `grn` + `material_issue` |

**D2C (5.3)**

| # | WHAT | Existing | Gap |
|---|---|---|---|
| 1 | Bill + e-way from signed packing slip | **◐** | `dispatch.eway_bill_no` ✅ **already there**; no Busy bill no., no bill date |
| 2 | Delivery confirmed with client | **✗** | |
| 3 | Receipt confirmed, payment date fixed | **◐** | `invoice`/`receipt` exist but are being hidden (Busy owns money); needs due date + follow-up dates only |
| 4 | Reminder before due date | **✗** | |
| 5 | Overdue escalation (reminder 1, 2, 3) | **✗** | |
| 6 | Payment recorded; overdue list | **◐** | `v_ar_ageing` ✅ — but the brief hides it |

---

## 3. PMS — daily planning (section 6)

| SOP | State | Gap |
|---|---|---|
| 9:45 meeting, S-30, PC rounds, 4 pm cut-off, 5:45 report | **✗** | A rhythm, not software — but 9:30 needs a "jobs due in 7 days + full-kit + IMS red" screen |
| Die-cut board, 3 lanes, daily sequence | **◐** | `plan_entry.sequence` + `machine_id` reusable; lane concept missing |
| Plan vs Actual at **1 pm and 5 pm** | **✗** | `plan_entry.planned_qty` exists; **no actual, no checkpoint times** |
| Urgent insertion log | **✗** | see Rule 4 |
| Setting start/end, sheets run, sheets wasted per changeover | **◐** | `press_run.wastage_qty` + `job_card.wastage_qty` exist but are **optional**; **no setting start/end, no sheets run** |
| Weekly preventive machine check (Sat) | **✗** | |
| Breakdown + downtime hours | **✗** | |

---

## 4. IMS (section 7)

| SOP | State |
|---|---|
| Top-10 repeat boards, daily use, lead time, safety factor | **✗** |
| **Max = daily use × lead time × safety factor** | **✗** |
| RED (≤ ⅓ max) / PURPLE (> max) | **◐** a manual-status override exists on a reorder list; the zones do not |
| Review max every 15 days, count monthly | **✗** |

Reuse `v_material_stock`. Do not duplicate stock maths.

---

## 5. Process Coordinator + Help Tickets (section 8)

| SOP | State |
|---|---|
| PC screen: every step due today or late, grouped by owner | **✗** — depends on flow steps |
| "Reminded at" log, two rounds (11:00, 15:30) | **✗** |
| **Help Ticket (A10)** — date, raised by, job & step, stuck with, problem, **3 solutions required**, Problem Solver, due, closed, resolution | **✗ no table** |
| Problem Solver routing (8.4) | **✗** — a 6-row lookup |

---

## 6. MIS scores, Delegation, E.M. (section 9)

| SOP | State | Gap |
|---|---|---|
| **Score = −(planned − done on time) ÷ planned × 100** | **✗** | needs flow steps + checklists + delegation in one population |
| Delegation Sheet | **✅** | `delegation_task` (assigned to/by, task, level, date given, expected, status, completed, blocker note) + `v_delegation_status` + `v_delegation_scorecard` |
| Delegation **levels** | **◐ conflict** | stored `L2, L3, L4` (three). SOP section 3 uses **Level 1–4** (four) with explicit meanings. A semantics decision, not a rename. |
| Monday E.M., scores declared, "do not ask why" | **✗** | a weekly report, not a module |
| Appraisal 80% MIS + 20% Delegation, quarterly | **✗** | |

**Company KPIs (9.5):** OTD ✅ `v_otd` · full-kit % ✗ · urgent insertions/week ✗ · die-cut
setting minutes ✗ · complaints/month ✗ · wastage % ◐ (captured, optional, so unmeasurable).
**Five of six KPIs cannot be computed today.**

---

## 7. Appendix checklists

| | Checklist | State |
|---|---|---|
| A1 | Job Opening Form | **◐** most fields exist; "Puneet informed (time)" and "promised date after approval" do not |
| A2 | Artwork (Puneet) | **✗** |
| A3 | Consumables (Puneet) | **✗** |
| A4 | Full Kit (Preeti) | **◐** 3 of 5, unenforced, no who/when |
| A5 | Changeover (Ajay) | **✗** |
| A6 | Packing (Ajay) | **✗** |
| A7 | Paper Request | **✗** |
| A8 | Paper Receiving | **✗** |
| A9 | Billing (Pradeep) | **✗** |
| A10 | Help Ticket | **✗** |
| A11 | Evening report | **✗** — WhatsApp, deliberately not software |

Every checklist is 5 items by BMP's rule, each needing tick + user + time. One generic
`checklist_item` mechanism serves A2–A9; nine bespoke forms would be a mistake.

---

## 8. What has to be built, consolidated

### Five new tables

1. **`flow_step_event`** — the 23 steps. Per item: step code, owner role, `planned_at`
   (trigger + TAT via `working_minutes_between`), `done_at`, `done_by`. Serves O2D,
   Purchase, D2C, the PC screen and the MIS score. **Build first; most else hangs off it.**
2. **`help_ticket`** — A10, with the three-solutions rule enforced (not a nullable text box).
3. **`paper_request`** — A7, plus supplier order + received, linked to job no.
4. **`checklist_item`** — generic 5-point checks with user + time, serving A2–A9 and full kit.
5. **`override_log`** — append-only. **Nothing in the schema stores *why*:** `audit_log` has
   `before`/`after` and `changed_by` but no reason, and no table has a `reason` column.
   Rules 2, 3, 4 and 7 every one need a logged, reasoned override. Build once, not four times.

### Fields on existing tables

- `po_item`: `artwork_sent_at`, approval → `committed_date` via the `Calculated` basis
- `press_run` / `job_card`: `setting_start`, `setting_end`, `sheets_run`; **make wastage required**
- `plan_entry`: `lane`, `actual_qty`, `checkpoint_at` (1 pm / 5 pm), `is_running`
- `dispatch`: `busy_bill_no`, `bill_date`, `client_informed_at` (`eway_bill_no` exists)
- `app_user`: **`phone`** — see below
- `tooling` / consumables: ordered / expected / received dates
- `machine`: preventive-check and downtime records

### One-way enum change

- `user_role` += **`PREPRESS`** for Puneet. Eight roles today, none fits. Rule 7 gates a print
  stage on his signature. **Enum additions cannot be undone — name it once.**

### Views

`v_flow_step_status` · `v_full_kit` · `v_mis_score_weekly` · `v_help_ticket_open` ·
`v_ims_zone` · `v_die_cut_board`

### The thing no table fixes

**`app_user.email` is NULL for all nine users and there is no phone column.** The SOP's
follow-up engine — PC rounds, ticket due dates, "stuck with", delegation deadlines — assumes
somebody gets told. The factory runs on WhatsApp; it is one of the three `confirmation_source`
values. A `phone` column plus `wa.me` links (not an API integration) makes a reminder one tap.

---

## 9. What the SOP asks for that should NOT go in the MIS

Worth stating so nobody builds it: the 9:45 meeting, the S-30, the Monday E.M., the 5:45
WhatsApp evening report (A11), the Canva flowcharts, the "ask don't tell" F.A.M. round, the
protection rule, Tally/Busy billing, and the paper gate register. These are practice. The MIS
supports them with screens and reports; it does not replace them. Brief rule 5 stands: Busy
remains the book of record for money.

---

## 10. Order to build

1. **`override_log`** — small, unblocks four rules.
2. **`app_user.phone` + WhatsApp links** — small, makes every later follow-up actually reach a person.
3. **Wastage compulsory** + setting start/end + sheets run — answers two dead KPIs, asked for 18-Nov.
4. **`flow_step_event`** + `v_flow_step_status` — the core. Map existing stage events first; only ask staff for what is genuinely missing.
5. **`checklist_item`** + full kit (5 points, enforced with override) — Rule 2.
6. **PC screen + `help_ticket`** — makes steps 4 and 5 self-correcting.
7. Die-cut board, lanes, Plan vs Actual, insertion log — Rules 3 and 4.
8. `paper_request` + receiving check + IMS zones — Phase 2.
9. Busy bill no. / bill date / payment follow-up — Phase 2.
10. `v_mis_score_weekly` + delegation level reconciliation — Phase 3.

Steps 1–3 are small and independent. Step 4 is the one that earns the rest.
