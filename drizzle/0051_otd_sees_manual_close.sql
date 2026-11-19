-- ===========================================================================
-- OTD sees a job closed by hand (section AA).
--
-- Asked for by Utkarsh on 19 Nov 2026: "fix the OTD thing too", closing the
-- gap left open as X7 when the manual close shipped.
--
-- FIRST, A CORRECTION TO X7. X7 said a manually closed job "disappears from
-- OTD entirely". That was read off v_otd as 0002 defined it and is NOT true of
-- the view as it stands: 0043 (the T1 auto-close) already added
-- `OR status = 'Closed'` to the filter. The real position is two narrower
-- faults, and BOTH of them flatter OTD:
--
--   1. ONLY IF SOMETHING WAS DISPATCHED. The filter also demands
--      dispatched_qty > 0, so a job closed by hand with nothing delivered is
--      absent from the measure altogether. This is the genuine exploit: close
--      it before the first challan and OTD never knew it existed.
--
--   2. A SHORT DELIVERY COULD SCORE AS ON TIME. on_time was
--      last_dispatch_date <= committed_date. Send 9,000 of 10,000 before the
--      promised date, short-close the rest, and the order counted as delivered
--      on time. Not a disappearance — worse, a false success.
--
-- Note that a job which is simply LATE was never helped by closing it:
-- last_dispatch_date <= committed_date is already false. The gap was never
-- "late jobs vanish"; it was "undelivered jobs vanish, and short ones can
-- pass".
--
-- WHAT THIS CHANGES.
--   * A short-closed job is admitted whether or not anything was dispatched.
--   * A short-closed job is never on time.
--   * Its fulfilment date is the day it was closed — the day the order stopped
--     being owed, which is the same definition a completed item already uses,
--     where the last piece leaving is that day.
--
-- WHAT THIS DELIBERATELY LEAVES ALONE. The T1 auto-close (0043) keeps its
-- scoring exactly as it is. A residual under 1,500 whose committed month has
-- passed retires itself, and if the bulk went out on time that order still
-- counts on time. That was Utkarsh's deliberate decision, it is tightly
-- fenced, and rescoring it here would rewrite history for orders already
-- closed under a rule nobody has changed. The two are told apart by
-- closed_manually_at, which only a person's close ever sets.
--
-- F8 IS KEPT. An item with no committed date is still excluded: there is
-- nothing to be late against, and a short close must not invent a promise that
-- was never made.
--
-- THE ACCEPTANCE CHECK HOLDS, by construction rather than by luck. Every new
-- term is guarded by `closed_manually_at IS NOT NULL`, and no row anywhere has
-- that set — nothing has ever been closed by hand. So v_otd returns exactly
-- the rows it returned before this migration, and OTD is unchanged by the
-- migration itself, which is what the SOP brief requires.
--
-- CREATE OR REPLACE for both views, new column LAST on v_po_item_status and no
-- column change at all on v_otd, so nothing is dropped and v_wip_ageing and
-- v_client_summary are untouched.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- v_po_item_status gains closed_manually_at, so v_otd can tell a person's
-- close from the T1 rule's.
-- ---------------------------------------------------------------------------

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

  -- N1, amended by section Z: no client PO number, typed by a person rather
  -- than imported, AND not job work. An imported historical order with no
  -- number is not waiting for one; neither is job work, where no PO is ever
  -- coming. Without the third term a job-work order would sit in the tracker
  -- asking for a document that does not exist, for as long as it existed.
  (
    po.po_no IS NULL
    AND po.import_batch_id IS NULL
    AND po.is_job_work = false
  )                                                        AS po_awaited,

  -- Section Z. Appended LAST, which is what lets CREATE OR REPLACE do this in
  -- place: v_otd, v_wip_ageing and v_client_summary select from here by name
  -- and are untouched.
  po.is_job_work,

  -- Section AA. Appended last again, so CREATE OR REPLACE stays in place.
  -- v_otd needs to tell a job somebody CLOSED BY HAND from one the T1 rule
  -- auto-closed, because only the first is scored as a delivery failure.
  pi.closed_manually_at

FROM po_item pi
JOIN purchase_order po ON po.id = pi.purchase_order_id
JOIN client c          ON c.id = po.client_id
LEFT JOIN dispatched dsp   ON dsp.po_item_id = pi.id
LEFT JOIN latest_stage ls  ON ls.po_item_id = pi.id
LEFT JOIN stage s          ON s.code = ls.stage_code
WHERE pi.deleted_at IS NULL
  AND po.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- v_otd: a job closed by hand is a delivery that did not happen.
--
-- Column names, order and types are unchanged, which is what lets this be a
-- CREATE OR REPLACE: v_client_summary selects from here and is untouched.
--
-- The settled_on CTE exists so the date is written ONCE. It feeds
-- fulfilment_date, days_late, lead_time_days and fulfilment_month, and four
-- copies of a CASE expression is how one of them ends up different from the
-- other three.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_otd AS
WITH settled AS (
  SELECT
    v.*,

    -- Short-closed: a person decided this job was over while something was
    -- still owed. NOT the same as the T1 auto-close, which leaves
    -- closed_manually_at null and keeps its existing scoring.
    (v.closed_manually_at IS NOT NULL AND v.pending_qty > 0) AS short_closed,

    -- THE DATE THE ORDER STOPPED BEING OWED, which is the one definition that
    -- covers both kinds of ending. For a completed item that is when the last
    -- piece left. For a short close nothing more was ever going to leave, so
    -- it is the day somebody said so. Converted at Asia/Kolkata (C10), or a
    -- close entered in the evening lands on the previous day.
    CASE
      WHEN v.closed_manually_at IS NOT NULL AND v.pending_qty > 0
        THEN (v.closed_manually_at AT TIME ZONE 'Asia/Kolkata')::date
      ELSE v.last_dispatch_date
    END AS settled_on
  FROM v_po_item_status v
)
SELECT
  po_item_id,
  item_code,
  item_name,
  client_id,
  client_code,
  client_name,
  po_date,
  ordered_qty,
  committed_date,
  settled_on                                       AS fulfilment_date,

  -- A short-closed job is NEVER on time. The whole premise of fulfilment_date
  -- is "the date by which the WHOLE ordered quantity had left", and for a
  -- short close it never did. Scoring it against the last partial dispatch
  -- would let a half-delivered order count as a success because the half that
  -- went out went out early.
  CASE
    WHEN short_closed THEN false
    ELSE (settled_on <= committed_date)
  END                                              AS on_time,

  (settled_on - committed_date)                    AS days_late,
  (settled_on - po_date)                           AS lead_time_days,
  date_trunc('month', settled_on)::date            AS fulfilment_month
FROM settled
WHERE (pending_qty <= 0 OR status = 'Closed')

  -- THE HOLE THIS CLOSES. Until now an item needed a dispatch to be measured
  -- at all, so a job closed by hand with NOTHING delivered left the measure
  -- entirely — the one genuine exploit: close it before dispatching and OTD
  -- never saw it. A job where nothing was delivered is the worst delivery
  -- failure there is, and it now counts as one.
  AND (dispatched_qty > 0 OR closed_manually_at IS NOT NULL)

  AND status <> 'Cancelled'

  -- F8 is kept: an item with no promise cannot be late, because there is
  -- nothing to be late against. A short close does not invent a commitment
  -- that was never made.
  AND committed_date IS NOT NULL;
