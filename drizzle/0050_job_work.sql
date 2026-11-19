-- ===========================================================================
-- Job work (section Z) — a job on the client's own material, with no PO coming.
--
-- Asked for by Utkarsh on 19 Nov 2026: "add an option to create job card for
-- job work as well", and when asked what job work should be in the MIS he chose
-- a job number marked as job work rather than a card floating free.
--
-- WHY A JOB NUMBER AND NOT A STANDALONE CARD. job_card_item.po_item_id is NOT
-- NULL, and po_item is the spine: stages, status, pending quantity, the Item
-- Tracker and OTD all hang off it. A card with no item would appear on no
-- screen and be measured by nothing. SOP Rule 1 says the same thing in the
-- factory's own words — "every job — PO, verbal, JOB WORK — is opened in MIS
-- before anything else". So job work is an ORDER, not the absence of one.
--
-- WHAT WAS ACTUALLY MISSING, and it was not a label. The system already lets a
-- job be raised before its PO arrives (U1): po_awaited means "no PO number, and
-- a person typed this rather than importing it". For job work NO PO IS EVER
-- COMING, so such an order would sit in the tracker asking for a document that
-- does not exist, permanently. One boolean fixes that, and the fix is in the
-- po_awaited expression rather than in a screen that remembers to special-case
-- it.
--
-- ON purchase_order, NOT po_item. Job work is a fact about the arrangement with
-- the client, not about one carton: the client sent material and asked for a
-- process. po_awaited is also computed from purchase_order, so the marker has
-- to live there for the two to be decided by one row rather than by a join that
-- could disagree.
--
-- NOT NULL DEFAULT false, which is safe precisely because it is the status quo:
-- every order that exists today is an ordinary order, and saying so explicitly
-- is cheaper than a nullable column whose null would mean "probably not job
-- work". This is the opposite call from `ups` (section Y) and `confirmed_at`
-- (W1), and deliberately so — those record something that was NOT observed
-- about past rows, where a default would invent data. Here the default is a
-- fact: nobody has ever marked an order job work, because they could not.
--
-- CREATE OR REPLACE, WITH THE NEW COLUMN LAST — the same move 0038 made and for
-- the same reason. Postgres permits changing a view's expressions and appending
-- to its column list in place, so v_otd, v_wip_ageing and v_client_summary keep
-- working untouched and no view is dropped. Everything in the body below except
-- po_awaited and the final column is verbatim from 0038.
--
-- WHAT DOES NOT CHANGE. No existing row changes meaning: po_awaited is false
-- for job work and job work is false everywhere, so every number on every
-- screen reads exactly as it did today. OTD is untouched. The money side is
-- untouched — Busy remains the book of record (brief rule 5), and this column
-- says nothing about rate or billing, only that no PO is coming.
-- ===========================================================================

ALTER TABLE "purchase_order"
  ADD COLUMN "is_job_work" boolean NOT NULL DEFAULT false;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- v_po_item_status: po_awaited stops firing for job work, and the flag is
-- exposed so screens read one definition rather than re-deriving it.
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
  po.is_job_work

FROM po_item pi
JOIN purchase_order po ON po.id = pi.purchase_order_id
JOIN client c          ON c.id = po.client_id
LEFT JOIN dispatched dsp   ON dsp.po_item_id = pi.id
LEFT JOIN latest_stage ls  ON ls.po_item_id = pi.id
LEFT JOIN stage s          ON s.code = ls.stage_code
WHERE pi.deleted_at IS NULL
  AND po.deleted_at IS NULL;
