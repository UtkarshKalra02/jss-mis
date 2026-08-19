# JSS The Print Zone — MIS v1 Build Specification

**Owner:** Utkarsh Kalra
**Maintainers:** Utkarsh + Deepak
**Status:** v1 spec, locked
**Book of record for accounts:** Busy (this system is a visibility layer, not a replacement)

---

## 1. What this system is

A desk-operated order tracking system for an offset printing and packaging factory.
It tracks an order from enquiry to payment, and produces one headline number: **OTD (On-Time Delivery %)**.

**In scope (v1)**
- Enquiry and quotation tracking (including lost enquiries)
- PO capture
- Item-level lifecycle tracking through production stages
- Job cards (one per item)
- Design / plate / die master
- Dispatch with partial-delivery support
- Invoicing and full AR ledger (receipts, outstanding, ageing)
- Reports: OTD, lead time, WIP ageing, quote-to-win, client concentration, AR ageing

**Explicitly out of scope (v1)**
- Costing engine (Costing exists as a *stage*, not a calculation)
- Shop-floor operator screens
- Machine-level time capture (makeready, utilization, wastage)
- Inventory / material stock
- Integration with Busy

**Design consequence:** because no process timestamps are captured, this system CANNOT
produce press utilization, makeready time, wastage %, or automatic bottleneck detection.
It CAN produce OTD, lead time, pending quantity, WIP by stage, and AR ageing.

---

## 2. Users and roles

| Role | Person | Device | Access |
|---|---|---|---|
| ADMIN | Utkarsh, Deepak | Desktop | Everything, including config and users |
| ORDER_DESK | Punit | Desktop | Enquiry, Quotation, PO, Design, Item Tracker |
| PLANNER | Preeti | Laptop | Job Planning, Stage Update, Dispatch, Item Tracker |
| ACCOUNTS | Pradeep | Desktop | Invoice, Receipts, AR Ledger, Item Tracker |
| FLOOR | Ajay | Phone | Stage Update only (mobile-optimised) |
| OWNER | Amit Kalra | Any | Dashboard + Item Tracker, read-only |

---

## 3. Core data model

### Cardinality rules (these are the spine — do not deviate)

```
CLIENT 1──< ENQUIRY 1──< QUOTATION
CLIENT 1──< PURCHASE_ORDER 1──< PO_ITEM
PO_ITEM 1──< JOB_CARD          (one job card covers exactly ONE po_item)
PO_ITEM 1──< DISPATCH_LINE     (partial dispatch: many lines per item)
PO_ITEM 1──< STAGE_EVENT       (append-only; current stage is DERIVED)
DISPATCH 1──< DISPATCH_LINE
INVOICE 1──< INVOICE_LINE      (invoice line references a dispatch_line)
INVOICE 1──< RECEIPT_ALLOCATION
RECEIPT 1──< RECEIPT_ALLOCATION
DESIGN 1──< PO_ITEM            (design is a reusable lookup, not a tracked entity)
```

**Key rules**
- One job card = one PO item. A PO item may have MULTIPLE job cards (repeat runs, split runs).
- No ganging across clients in v1. Each item gets its own job card.
- `pending_qty = ordered_qty - SUM(dispatch_line.qty)` — always computed, never stored.
- `current_stage` is derived from the latest `stage_event`, never a mutable column.
- An enquiry that never converts stays in the system with `status = 'Lost'`.

---

## 4. Database schema (PostgreSQL)

All tables have: `id` (uuid, pk), `created_at`, `updated_at`, `created_by`, `updated_by`.
All monetary values: `numeric(14,2)`. All quantities: `integer`.
Soft delete via `deleted_at timestamptz null` — never hard delete.

### 4.1 Reference

**`client`**
| Column | Type | Notes |
|---|---|---|
| code | text unique | e.g. NAT, MUL |
| name | text not null | |
| gstin | text | |
| address_line1/2, city, state, pincode | text | |
| contact_name, contact_phone, contact_email | text | |
| payment_terms_days | integer default 30 | drives invoice due date |
| credit_limit | numeric(14,2) | warn on exceed, do not block |
| client_type | enum('New','Repeat') | |
| is_active | boolean default true | |

**`stage`** (seeded config, editable by ADMIN)
| Column | Type | Notes |
|---|---|---|
| code | text unique | ENQUIRY, COSTING, PO_RECEIVED, DESIGN, APPROVED, MATERIAL_READY, PRINTING, LAMINATION, UV, FOILING, DIE_CUT, PASTING, READY, DISPATCHED |
| name | text | display name |
| sequence | integer | ordering |
| is_optional | boolean | true for LAMINATION, UV, FOILING, PASTING |
| applies_to | enum('All','New','Repeat') | ENQUIRY + COSTING = 'New' |
| target_hours | numeric(6,2) | from the Excel tracker; used for at-risk calculation |
| colour | text | hex, for the UI pill |

**`app_user`**
| Column | Type |
|---|---|
| username, name, email | text |
| role | enum(ADMIN, ORDER_DESK, PLANNER, ACCOUNTS, FLOOR, OWNER) |
| password_hash | text |
| is_active | boolean |
| last_login_at | timestamptz |

### 4.2 Pre-order

**`enquiry`**
| Column | Type | Notes |
|---|---|---|
| enquiry_no | text unique | auto: ENQ-YYYY-NNNN |
| client_id | fk client | |
| enquiry_date | date | |
| description | text | |
| expected_qty | integer | |
| status | enum('Open','Quoted','Won','Lost') | |
| lost_reason | text | required when status = Lost |
| closed_at | date | |
| owner_user_id | fk app_user | |

**`quotation`**
| Column | Type | Notes |
|---|---|---|
| quote_no | text unique | QT-YYYY-NNNN |
| enquiry_id | fk enquiry | |
| quote_date | date | |
| valid_until | date | |
| rate_per_unit | numeric(14,2) | manually entered — no costing engine in v1 |
| total_value | numeric(14,2) | |
| status | enum('Sent','Accepted','Rejected','Expired') | |
| notes | text | |

### 4.3 Order

**`purchase_order`**
| Column | Type | Notes |
|---|---|---|
| po_no | text | client's PO number |
| internal_no | text unique | PO-YYYY-NNNN |
| client_id | fk client | |
| po_date | date not null | |
| enquiry_id | fk enquiry nullable | set when converted from enquiry |
| file_url | text | scanned PO |
| status | enum('Open','Partially Dispatched','Closed','Cancelled') | derived nightly + on write |
| notes | text | |

**`po_item`** — **THE SPINE**
| Column | Type | Notes |
|---|---|---|
| item_code | text unique | ITM-YYYY-NNNNN |
| purchase_order_id | fk purchase_order | |
| design_id | fk design nullable | |
| item_name | text not null | |
| ordered_qty | integer not null | |
| rate | numeric(14,2) | |
| committed_date | date | **the single most important field** |
| committed_date_basis | text | 'Manual' in v1; later 'Calculated' |
| priority | enum('Normal','High','Urgent') | |
| status | enum('Open','Closed','Cancelled') | Closed when fully dispatched |
| remarks | text | |

Derived (views, not columns): `dispatched_qty`, `pending_qty`, `current_stage`, `days_to_committed`, `is_at_risk`, `is_overdue`.

**`design`**
| Column | Type |
|---|---|
| design_code | text unique (DSN-NNNNN) |
| client_id | fk client |
| job_name, job_size, gsm, paper_type | text |
| print_type, no_of_colours | text |
| processes | text[] — stage codes that apply |
| die_id, plate_id | text |
| die_status, plate_status | enum('Pending','Ordered','Received','Old','NA') |
| approval_status | enum('Pending','Approved','Rejected') |
| approved_at, approved_by | timestamptz / fk |
| artwork_url | text |
| is_active | boolean |

### 4.4 Production

**`job_card`**
| Column | Type | Notes |
|---|---|---|
| jc_no | text unique | JC-YYYY-NNNN |
| po_item_id | fk po_item not null | ONE item per job card |
| planned_qty | integer | may be < ordered_qty for split runs |
| planned_date | date | which day it's scheduled to run |
| status | enum('Planned','In Process','On Hold','Completed','Cancelled') |
| hold_reason | text |
| notes | text |

**`stage_event`** — append-only, never update or delete
| Column | Type | Notes |
|---|---|---|
| po_item_id | fk po_item not null | |
| job_card_id | fk job_card nullable | |
| stage_code | fk stage.code | |
| event_at | timestamptz not null | when it actually happened, not when typed |
| entered_by | fk app_user | |
| remarks | text | |

Index on `(po_item_id, event_at desc)`.

### 4.5 Dispatch

**`dispatch`**
| Column | Type |
|---|---|
| challan_no | text unique (CH-YYYY-NNNN) |
| client_id | fk client |
| dispatch_date | date not null |
| vehicle_no, transporter | text |
| eway_bill_no | text |
| status | enum('Draft','Dispatched','Cancelled') |
| remarks | text |

**`dispatch_line`**
| Column | Type |
|---|---|
| dispatch_id | fk dispatch |
| po_item_id | fk po_item |
| qty | integer not null, check > 0 |
| rate | numeric(14,2) |

**Constraint:** `SUM(dispatch_line.qty) per po_item <= po_item.ordered_qty`. Enforce in application layer with a clear error; also add a DB trigger.

**OTD is computed here.** When the dispatch line that brings `pending_qty` to zero is saved, that dispatch's `dispatch_date` is the item's fulfilment date. On-time if `<= committed_date`.

### 4.6 Accounts Receivable

**`invoice`**
| Column | Type | Notes |
|---|---|---|
| invoice_no | text unique | matches the number raised in Busy |
| client_id | fk client | |
| invoice_date | date not null | |
| due_date | date | invoice_date + client.payment_terms_days |
| taxable_amount | numeric(14,2) | |
| cgst, sgst, igst | numeric(14,2) | |
| total_amount | numeric(14,2) | |
| status | enum('Draft','Raised','Partially Paid','Paid','Cancelled') | derived from allocations |
| busy_synced | boolean default false | manual tick — reconciliation aid |
| notes | text | |

**`invoice_line`**
| Column | Type |
|---|---|
| invoice_id | fk invoice |
| dispatch_line_id | fk dispatch_line |
| description | text |
| qty | integer |
| rate | numeric(14,2) |
| amount | numeric(14,2) |

**`receipt`**
| Column | Type |
|---|---|
| receipt_no | text unique (RCP-YYYY-NNNN) |
| client_id | fk client |
| receipt_date | date not null |
| amount | numeric(14,2) not null |
| mode | enum('NEFT','RTGS','Cheque','Cash','UPI','Other') |
| reference_no | text |
| notes | text |

**`receipt_allocation`** — lets one receipt settle several invoices
| Column | Type |
|---|---|
| receipt_id | fk receipt |
| invoice_id | fk invoice |
| amount | numeric(14,2) not null |

**Constraints:** `SUM(allocation.amount) per receipt <= receipt.amount` (remainder = on-account credit);
`SUM(allocation.amount) per invoice <= invoice.total_amount`.

Derived: `invoice.paid_amount`, `invoice.outstanding`, `invoice.days_overdue`, client `total_outstanding`.

### 4.7 Audit

**`audit_log`**
| Column | Type |
|---|---|
| table_name, record_id, action | text |
| changed_by | fk app_user |
| changed_at | timestamptz |
| before, after | jsonb |

Write on every insert/update/delete via a shared repository wrapper.

---

## 5. Derived views to create

- `v_po_item_status` — item + dispatched_qty, pending_qty, current_stage, days_to_committed, risk flag
- `v_otd` — one row per fully-dispatched item with committed_date, fulfilment_date, on_time boolean
- `v_wip_ageing` — items by current stage with hours/days sitting in that stage
- `v_ar_ageing` — invoice outstanding bucketed 0-30 / 31-60 / 61-90 / 90+
- `v_client_summary` — order value, dispatch value, outstanding, OTD% per client
- `v_enquiry_funnel` — enquiry → quoted → won/lost counts and conversion rate

---

## 6. Screens

### 6.1 Dashboard (landing, all roles — content varies by role)
- **OTD % (rolling 30 days)** — large, primary metric, with trend arrow vs previous 30 days
- Overdue items (committed date passed, not fully dispatched) — count + clickable list
- At-risk items (committed within 3 days, not READY) — count + list
- WIP by stage — horizontal bar
- Dispatched this month — value + item count
- AR outstanding + overdue amount (ACCOUNTS, ADMIN, OWNER only)
- Open enquiries (ORDER_DESK, ADMIN)

### 6.2 Enquiry (ORDER_DESK)
List with status filter. Create → client, date, description, expected qty.
Actions: Add quotation · Mark Won (→ converts to PO, prefilled) · Mark Lost (reason required).

### 6.3 PO Capture (ORDER_DESK)
Header: client, PO no, PO date, upload scan.
Item rows: item name, design (search existing or create), qty, rate, **committed date**, priority.
On save: creates `po_item` rows and a `PO_RECEIVED` stage event for each.

### 6.4 Item Tracker (everyone — the "stop asking people" screen)
Search by item code, item name, client, PO no, job card no.
Detail view: ordered / dispatched / pending · current stage pill · committed date + days remaining ·
full stage timeline · linked job cards · linked dispatches · linked invoices.

### 6.5 Design Master (ORDER_DESK)
Searchable grid. Create/edit design. Die and plate status. Approval action with timestamp.

### 6.6 Job Planning (PLANNER — this is the 6pm meeting screen)
Two panels.
Left: unplanned items sorted by committed date, colour-coded (red overdue, amber ≤3 days, green fine).
Right: tomorrow grouped by stage/station.
Assign item → creates `job_card` with `planned_date`.
**Print action:** produces the daily floor plan, jobs grouped by station, bold job names, minimal.
Toggle: English / Hindi (Devanagari).

### 6.7 Stage Update (PLANNER desktop, FLOOR mobile)
Grid of open items: item, client, current stage, days to committed.
Row action → set new stage → writes `stage_event`.
**Bulk select** → set same stage for many rows at once.
Mobile view: card list, large tap targets, single stage dropdown, nothing else.

### 6.8 Dispatch (PLANNER / ACCOUNTS)
Select client → shows their items with `pending_qty > 0` and stage = READY.
Enter dispatch qty per item (defaults to full pending, editable for partial).
Save → creates dispatch + lines, writes `DISPATCHED` stage event where fully dispatched.
**Print challan** — A4, company header, GSTIN, item table, signature block.

### 6.9 Invoicing (ACCOUNTS)
Select client → shows dispatch lines not yet invoiced.
Select lines → generate invoice → invoice no, date, due date auto from payment terms, GST fields.
Print invoice. Mark `busy_synced` once entered in Busy.

### 6.10 Receipts & AR Ledger (ACCOUNTS, ADMIN, OWNER)
Record receipt → allocate across open invoices (with an "auto-allocate oldest first" button).
Ledger view per client: invoices, receipts, running balance.
**AR ageing table:** client × 0-30 / 31-60 / 61-90 / 90+ / total.

### 6.11 Reports
- OTD by month, by client
- Lead time distribution (PO date → fulfilment date)
- WIP ageing — what has been sitting too long
- Enquiry funnel and quote-to-win rate
- Client concentration — revenue share by client
- AR ageing

### 6.12 Admin (ADMIN)
Users and roles · stage config (targets, colours, optional flags) · client master · number series.

---

## 7. Design direction

The brief is "easy to use but very good looking." Concretely:

**Layout:** fixed left sidebar (icon + label), top bar with global search and user menu, content area max-width 1400px.

**Type:** Inter (or system font stack). Page titles 24px semibold. Body 14px. Table text 13px. Numbers in tabular figures (`font-variant-numeric: tabular-nums`) so columns align.

**Colour:** near-neutral base (zinc/slate). ONE accent — deep indigo. Semantic only elsewhere: red overdue, amber at-risk, green on-time/paid, grey neutral. Do not colour anything decoratively.

**Density:** tables are the product. 40px row height, sticky header, zebra off, hover highlight on, inline column search, sortable headers, pagination at 50.

**Stage display:** small rounded pill, stage colour at 12% opacity background with solid text colour.

**Numbers:** Indian formatting throughout (₹1,23,456 — lakh/crore grouping, not thousands).

**Feedback:** skeleton loaders, never spinners on full page. Optimistic updates on stage change. Toast on save. Inline validation, never a modal for errors.

**Print:** dedicated print stylesheets for challan, invoice, and daily floor plan. These get printed daily — treat them as first-class screens, not afterthoughts.

**Mobile:** only Stage Update and Item Tracker need to work well on a phone. The rest may be desktop-first.

---

## 8. Build phases

Ship each phase before starting the next. Each is independently useful.

**Phase 1 — Foundation (week 1-2)**
Next.js + TypeScript + Drizzle + Postgres scaffold. Auth with roles. Layout shell, sidebar, empty dashboard. Client master CRUD. Stage config seeded. Audit wrapper. Deployed to Vercel.
*Done when:* six users can log in and see a shell with correct nav for their role.

**Phase 2 — Order spine (week 3-4)**
PO capture, PO item, design master, item tracker, stage events, stage update screen.
Migrate historical PO data from the old Sheets.
*Done when:* Punit enters real POs and Preeti updates stages daily.

**Phase 3 — Dispatch and OTD (week 5-6)**
Dispatch screen, partial dispatch, challan print, OTD view, dashboard metrics.
Migrate historical dispatch log.
*Done when:* a real OTD number appears on the dashboard.

**Phase 4 — Planning (week 7-8)**
Job cards, job planning board, printable daily floor plan (EN + HI).
*Done when:* the 6pm queue meeting runs off this screen.

**Phase 5 — Accounts (week 9-11)**
Invoice, receipts, allocations, AR ledger, ageing.
*Done when:* Pradeep can answer "what's outstanding from X" without opening Busy.

**Phase 6 — Reports and polish (week 12)**
All reports, enquiry funnel, export to Excel, mobile polish.

---

## 9. Migration from old system

From the old Google Sheets, migrate only:
- **PO Form Responses** → `purchase_order` + `po_item`
- **Dispatch Log** → `dispatch` + `dispatch_line`
- **Client list** → `client`

Do NOT migrate: Item Master (never existed), planning tables (schema unclear), FMS DB_Format tabs (computed views, will be regenerated).

Write migration as a one-off script with a dry-run mode that reports row counts and rejects before writing.

---

## 10. Non-negotiables

1. `current_stage` is derived, never stored.
2. `pending_qty` is computed, never stored.
3. Every write goes through the audit wrapper.
4. Foreign keys enforced at the database level, not just in application code.
5. No enum values hardcoded in components — read from `stage` table and TypeScript enums generated from the schema.
6. Committed date is required at every human entry point. The system's whole purpose
   fails without it. It is nullable in the database for ONE reason only: imported
   historical rows, which genuinely have no commitment recorded and are therefore
   excluded from OTD entirely — never counted as met, never counted as missed. See
   decision F8.
7. Soft delete only.
