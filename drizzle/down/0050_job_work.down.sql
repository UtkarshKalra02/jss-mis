-- ===========================================================================
-- DOWN for 0050_job_work (section Z).
--
-- Drops purchase_order.is_job_work and puts v_po_item_status back to the shape
-- 0038 left it in, where po_awaited is just "no client PO number, not
-- imported".
--
-- THIS ONE LOSES DATA, and it is the only down file in the batch that does.
-- Every order marked job work forgets that it is job work, because the fact
-- lives nowhere else. Those orders will start showing as PO-awaited again and
-- will ask the office for a document that is never coming. Count them before
-- running this:
--
--   SELECT count(*) FROM purchase_order WHERE is_job_work;
--
-- Run 0051's down first, or v_po_item_status will still be selecting
-- closed_manually_at, which 0048's down then cannot remove.
-- ===========================================================================

-- Any order marked job work is about to forget it. Nothing reads this row
-- afterwards; it is here so a rollback leaves a record of what was lost.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM purchase_order WHERE is_job_work;
  RAISE NOTICE 'down 0050: % purchase_order row(s) marked job work are losing that flag', v_n;
END $$;
--> statement-breakpoint

-- v_po_item_status cannot lose a column to CREATE OR REPLACE — Postgres allows
-- that statement to change expressions and to APPEND columns, never to remove
-- one. Going back therefore means dropping it and rebuilding the three views
-- that read it. They are rebuilt here from the migrations that define them, so
-- this file is the whole of the restoration and does not depend on what any
-- particular database happens to hold.
DROP VIEW IF EXISTS v_po_item_status CASCADE;
--> statement-breakpoint

CREATE OR REPLACE VIEW v_po_item_status AS
WITH dispatched AS (
  -- F22: 'Dispatched' ONLY. A draft is typed but not gone, and a cancelled
  -- challan never went. Both leave the quantity owed.
  SELECT
    dl.po_item_id,
    SUM(dl.qty)::integer     AS dispatched_qty,
    MAX(d.dispatch_date)     AS last_dispatch_date
  FROM dispatch_line dl
  JOIN dispatch d ON d.id = dl.dispatch_id
  WHERE dl.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.status = 'Dispatched'
  GROUP BY dl.po_item_id
),
latest_stage AS (
  -- NON-NEGOTIABLE 1: current stage is the most recent event, never a column.
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

  -- An item with NO committed date cannot be overdue — there is nothing to be
  -- late against (F8). FALSE rather than NULL, or it vanishes from both
  -- `WHERE is_overdue` and `WHERE NOT is_overdue`.
  (
    pi.committed_date IS NOT NULL
    AND pi.committed_date < today_ist()
    AND pi.ordered_qty - COALESCE(dsp.dispatched_qty, 0) > 0
    AND pi.status = 'Open'
  )                                                        AS is_overdue,

  (
    pi.committed_date IS NOT NULL
    AND pi.committed_date >= today_ist()
    AND pi.committed_date <= today_ist() + app_setting_int('at_risk_window_days', 3)
    AND COALESCE(ls.stage_code, '') NOT IN ('READY', 'DISPATCHED')
    AND pi.ordered_qty - COALESCE(dsp.dispatched_qty, 0) > 0
    AND pi.status = 'Open'
  )                                                        AS is_at_risk,

  -- N1: no client PO number, and typed by a person rather than imported. An
  -- imported historical order with no number is not waiting for one.
  (po.po_no IS NULL AND po.import_batch_id IS NULL)        AS po_awaited

FROM po_item pi
JOIN purchase_order po ON po.id = pi.purchase_order_id
JOIN client c          ON c.id = po.client_id
LEFT JOIN dispatched dsp   ON dsp.po_item_id = pi.id
LEFT JOIN latest_stage ls  ON ls.po_item_id = pi.id
LEFT JOIN stage s          ON s.code = ls.stage_code
WHERE pi.deleted_at IS NULL
  AND po.deleted_at IS NULL;
--> statement-breakpoint

CREATE OR REPLACE VIEW v_otd AS
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
WHERE (v.pending_qty <= 0 OR v.status = 'Closed')
  AND v.dispatched_qty > 0
  AND v.status <> 'Cancelled'
  AND v.committed_date IS NOT NULL;
--> statement-breakpoint

-- Rebuilt unchanged: v_wip_ageing as 0002 left it, v_client_summary as 0008
-- left it. They are collateral of the CASCADE, not part of what is being
-- reversed.

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

CREATE OR REPLACE VIEW v_client_summary AS
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
    AND d.status = 'Dispatched'
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

ALTER TABLE "purchase_order" DROP COLUMN IF EXISTS "is_job_work";
