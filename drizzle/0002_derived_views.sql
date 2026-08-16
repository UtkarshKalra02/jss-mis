-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- The six derived views from spec section 5.
--
-- ###########################################################################
-- #                                                                         #
-- #  ALL DATE-BOUNDARY ARITHMETIC IN THIS FILE CASTS TO Asia/Kolkata.       #
-- #                                                                         #
-- #  Never compare a timestamptz to a date without going through            #
-- #  today_ist(). A dispatch entered at 9pm IST is 15:30 UTC the SAME day,  #
-- #  but 2am IST is 20:30 UTC the PREVIOUS day. Compare naively and an      #
-- #  item delivered on its committed date is recorded a day late — which    #
-- #  silently corrupts OTD, the one number this system exists to produce.   #
-- #  The corruption is invisible: no error, just a slightly wrong           #
-- #  percentage that nobody can reproduce.                                  #
-- #                                                                         #
-- ###########################################################################
--
-- These views are where non-negotiables 1 and 2 stop being a convention and
-- become a property of the database. current_stage and pending_qty are
-- computed here and exist nowhere else. Any consumer — the app, a report, a
-- psql session — gets the same answer, because there is only one definition.
--
-- If you ever want to "just add a pending_qty column to make this query
-- faster", that is the moment the data starts lying. Add an index instead.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Today, in the factory's timezone. Every date comparison goes through this.
CREATE OR REPLACE FUNCTION today_ist() RETURNS date AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

-- Reads an integer from app_setting, falling back to a default. Lets ADMIN
-- tune thresholds without a deploy while keeping the views self-contained.
CREATE OR REPLACE FUNCTION app_setting_int(p_key text, p_default integer)
RETURNS integer AS $$
  SELECT COALESCE(
    (SELECT value::integer FROM app_setting
      WHERE key = p_key AND deleted_at IS NULL),
    p_default
  );
$$ LANGUAGE sql STABLE;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 1. v_po_item_status — the spine view
--
-- Everything else in this file is built on it. One row per live PO item, with
-- quantities, derived stage, and the two risk flags.
-- ---------------------------------------------------------------------------

CREATE VIEW v_po_item_status AS
WITH dispatched AS (
  -- Cancelled and soft-deleted challans do not consume order quantity.
  SELECT
    dl.po_item_id,
    SUM(dl.qty)::integer     AS dispatched_qty,
    MAX(d.dispatch_date)     AS last_dispatch_date
  FROM dispatch_line dl
  JOIN dispatch d ON d.id = dl.dispatch_id
  WHERE dl.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.status <> 'Cancelled'
  GROUP BY dl.po_item_id
),
latest_stage AS (
  -- NON-NEGOTIABLE 1: current stage is the most recent event, never a column.
  -- Ordered by event_at (when it happened on the floor), with created_at and
  -- id as tie-breakers so the result is deterministic when two events share a
  -- timestamp — which happens whenever stages are updated in a batch.
  SELECT DISTINCT ON (se.po_item_id)
    se.po_item_id,
    se.stage_code,
    se.event_at
  FROM stage_event se
  ORDER BY se.po_item_id, se.event_at DESC, se.created_at DESC, se.id DESC
)
SELECT
  pi.id                        AS po_item_id,
  pi.item_code,
  pi.item_name,
  pi.purchase_order_id,
  po.internal_no               AS po_internal_no,
  po.po_no                     AS client_po_no,
  po.po_date,
  po.client_id,
  c.code                       AS client_code,
  c.name                       AS client_name,
  pi.design_id,
  pi.job_type,
  pi.priority,
  pi.status,

  pi.ordered_qty,
  COALESCE(dsp.dispatched_qty, 0)                          AS dispatched_qty,
  -- NON-NEGOTIABLE 2: pending is computed here and stored nowhere.
  pi.ordered_qty - COALESCE(dsp.dispatched_qty, 0)         AS pending_qty,
  dsp.last_dispatch_date,

  ls.stage_code                AS current_stage,
  s.name                       AS current_stage_name,
  s.colour                     AS current_stage_colour,
  s.sequence                   AS current_stage_sequence,
  ls.event_at                  AS current_stage_since,

  pi.committed_date,
  (pi.committed_date - today_ist())                        AS days_to_committed,

  -- Overdue: the committed date has passed and quantity is still owed.
  (
    pi.committed_date < today_ist()
    AND pi.ordered_qty - COALESCE(dsp.dispatched_qty, 0) > 0
    AND pi.status = 'Open'
  )                                                        AS is_overdue,

  -- At risk (decision B3): committed within the configured window and not yet
  -- READY. This is the DASHBOARD rule. The other at-risk signal — an item
  -- sitting in one stage past its target hours — lives in v_wip_ageing.
  (
    pi.committed_date >= today_ist()
    AND pi.committed_date <= today_ist() + app_setting_int('at_risk_window_days', 3)
    AND COALESCE(ls.stage_code, '') NOT IN ('READY', 'DISPATCHED')
    AND pi.ordered_qty - COALESCE(dsp.dispatched_qty, 0) > 0
    AND pi.status = 'Open'
  )                                                        AS is_at_risk

FROM po_item pi
JOIN purchase_order po ON po.id = pi.purchase_order_id
JOIN client c          ON c.id = po.client_id
LEFT JOIN dispatched dsp   ON dsp.po_item_id = pi.id
LEFT JOIN latest_stage ls  ON ls.po_item_id = pi.id
LEFT JOIN stage s          ON s.code = ls.stage_code
WHERE pi.deleted_at IS NULL
  AND po.deleted_at IS NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. v_otd — one row per fully-dispatched item
--
-- Fulfilment date is MAX(dispatch_date) across the item's live challans, i.e.
-- the date by which the whole ordered quantity had left. Using the maximum
-- rather than "the line that brought pending to zero" makes it independent of
-- the order lines were ENTERED in — back-dated challans are routine, and the
-- last row created is not necessarily the last delivery.
-- ---------------------------------------------------------------------------

CREATE VIEW v_otd AS
SELECT
  v.po_item_id,
  v.item_code,
  v.item_name,
  v.client_id,
  v.client_code,
  v.client_name,
  v.po_date,
  v.ordered_qty,
  v.committed_date,
  v.last_dispatch_date                       AS fulfilment_date,
  (v.last_dispatch_date <= v.committed_date) AS on_time,
  (v.last_dispatch_date - v.committed_date)  AS days_late,
  (v.last_dispatch_date - v.po_date)         AS lead_time_days,
  date_trunc('month', v.last_dispatch_date)::date AS fulfilment_month
FROM v_po_item_status v
WHERE v.pending_qty <= 0
  AND v.dispatched_qty > 0
  AND v.status <> 'Cancelled';
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. v_wip_ageing — what has been sitting too long
--
-- target_hours_verified is carried through deliberately (decision A2). The
-- seeded targets are placeholders from an example workbook, never measured,
-- and any screen showing is_over_target must be able to say so. A threshold
-- nobody has checked should not look like a fact.
-- ---------------------------------------------------------------------------

CREATE VIEW v_wip_ageing AS
SELECT
  v.po_item_id,
  v.item_code,
  v.item_name,
  v.client_code,
  v.client_name,
  v.pending_qty,
  v.priority,
  v.current_stage,
  v.current_stage_name,
  v.current_stage_colour,
  v.current_stage_since,

  ROUND((EXTRACT(EPOCH FROM (now() - v.current_stage_since)) / 3600.0)::numeric, 1)
                                        AS hours_in_stage,
  s.target_hours,
  s.target_hours_verified,
  CASE
    WHEN s.target_hours IS NULL OR s.target_hours = 0 THEN NULL
    ELSE (EXTRACT(EPOCH FROM (now() - v.current_stage_since)) / 3600.0) > s.target_hours
  END                                   AS is_over_target,

  v.committed_date,
  v.days_to_committed,
  v.is_overdue,
  v.is_at_risk
FROM v_po_item_status v
LEFT JOIN stage s ON s.code = v.current_stage
WHERE v.status = 'Open'
  AND v.pending_qty > 0
  AND v.current_stage IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. v_ar_ageing — outstanding per invoice, bucketed
--
-- One row per live invoice. The client x bucket grid in section 6.10 pivots
-- from this rather than duplicating the bucket boundaries.
-- ---------------------------------------------------------------------------

CREATE VIEW v_ar_ageing AS
WITH allocated AS (
  SELECT invoice_id, SUM(amount) AS paid_amount
  FROM receipt_allocation
  WHERE deleted_at IS NULL
  GROUP BY invoice_id
)
SELECT
  i.id                                        AS invoice_id,
  i.invoice_no,
  i.client_id,
  c.code                                      AS client_code,
  c.name                                      AS client_name,
  i.invoice_date,
  i.due_date,
  i.total_amount,
  COALESCE(a.paid_amount, 0)                  AS paid_amount,
  i.total_amount - COALESCE(a.paid_amount, 0) AS outstanding,

  CASE
    WHEN i.due_date IS NULL          THEN NULL
    WHEN i.due_date >= today_ist()   THEN 0
    ELSE today_ist() - i.due_date
  END                                         AS days_overdue,

  CASE
    WHEN i.total_amount - COALESCE(a.paid_amount, 0) <= 0 THEN 'Paid'
    WHEN i.due_date IS NULL                               THEN '0-30'
    WHEN today_ist() - i.due_date <= 30                   THEN '0-30'
    WHEN today_ist() - i.due_date <= 60                   THEN '31-60'
    WHEN today_ist() - i.due_date <= 90                   THEN '61-90'
    ELSE '90+'
  END                                         AS ageing_bucket,

  i.status,
  i.busy_synced
FROM invoice i
JOIN client c ON c.id = i.client_id
LEFT JOIN allocated a ON a.invoice_id = i.id
WHERE i.deleted_at IS NULL
  AND i.status <> 'Cancelled';
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. v_client_summary — one row per client
-- ---------------------------------------------------------------------------

CREATE VIEW v_client_summary AS
WITH order_value AS (
  SELECT
    po.client_id,
    SUM(pi.ordered_qty * COALESCE(pi.rate, 0)) AS order_value,
    COUNT(*)::integer                          AS item_count
  FROM po_item pi
  JOIN purchase_order po ON po.id = pi.purchase_order_id
  WHERE pi.deleted_at IS NULL
    AND po.deleted_at IS NULL
    AND pi.status <> 'Cancelled'
  GROUP BY po.client_id
),
dispatch_value AS (
  SELECT
    d.client_id,
    SUM(dl.qty * COALESCE(dl.rate, 0)) AS dispatch_value
  FROM dispatch_line dl
  JOIN dispatch d ON d.id = dl.dispatch_id
  WHERE dl.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.status <> 'Cancelled'
  GROUP BY d.client_id
),
ar AS (
  SELECT
    client_id,
    SUM(outstanding)                                                   AS total_outstanding,
    SUM(CASE WHEN days_overdue > 0 THEN outstanding ELSE 0 END)        AS overdue_outstanding
  FROM v_ar_ageing
  GROUP BY client_id
),
otd AS (
  SELECT
    client_id,
    COUNT(*)::integer                        AS delivered_items,
    COUNT(*) FILTER (WHERE on_time)::integer AS on_time_items,
    ROUND(100.0 * COUNT(*) FILTER (WHERE on_time) / NULLIF(COUNT(*), 0), 1) AS otd_pct
  FROM v_otd
  GROUP BY client_id
)
SELECT
  c.id AS client_id,
  c.code,
  c.name,
  c.client_type,
  c.is_active,
  c.credit_limit,
  COALESCE(ov.order_value, 0)          AS order_value,
  COALESCE(ov.item_count, 0)           AS item_count,
  COALESCE(dv.dispatch_value, 0)       AS dispatch_value,
  COALESCE(ar.total_outstanding, 0)    AS total_outstanding,
  COALESCE(ar.overdue_outstanding, 0)  AS overdue_outstanding,
  COALESCE(otd.delivered_items, 0)     AS delivered_items,
  otd.otd_pct
FROM client c
LEFT JOIN order_value ov    ON ov.client_id = c.id
LEFT JOIN dispatch_value dv ON dv.client_id = c.id
LEFT JOIN ar                ON ar.client_id = c.id
LEFT JOIN otd               ON otd.client_id = c.id
WHERE c.deleted_at IS NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 6. v_enquiry_funnel — by month and client
--
-- "Quoted" means the enquiry actually has a quotation attached, not that
-- somebody set the status to 'Quoted'. Statuses drift; rows do not.
-- ---------------------------------------------------------------------------

CREATE VIEW v_enquiry_funnel AS
WITH quoted AS (
  SELECT DISTINCT enquiry_id
  FROM quotation
  WHERE deleted_at IS NULL
)
SELECT
  date_trunc('month', e.enquiry_date)::date            AS month,
  e.client_id,
  c.code                                               AS client_code,
  c.name                                               AS client_name,
  COUNT(*)::integer                                    AS enquiry_count,
  COUNT(*) FILTER (WHERE q.enquiry_id IS NOT NULL)::integer AS quoted_count,
  COUNT(*) FILTER (WHERE e.status = 'Won')::integer    AS won_count,
  COUNT(*) FILTER (WHERE e.status = 'Lost')::integer   AS lost_count,
  COUNT(*) FILTER (WHERE e.status = 'Open')::integer   AS open_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE e.status = 'Won')
          / NULLIF(COUNT(*) FILTER (WHERE q.enquiry_id IS NOT NULL), 0), 1
  )                                                    AS quote_to_win_pct
FROM enquiry e
JOIN client c ON c.id = e.client_id
LEFT JOIN quoted q ON q.enquiry_id = e.id
WHERE e.deleted_at IS NULL
GROUP BY 1, 2, 3, 4;
