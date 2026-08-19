-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- Settles decision F22: a Draft challan is TYPED BUT NOT GONE.
--
-- Until now `Draft` consumed order quantity exactly as `Dispatched` did,
-- because everything that asked "which challans count?" asked it as
-- `status <> 'Cancelled'`. The effect was that starting a draft made an item
-- disappear from the list of what a client is still owed — the opposite of
-- what a draft should mean.
--
-- The new definition is a POSITIVE list: goods have left when the challan says
-- 'Dispatched'. Positive rather than `NOT IN ('Draft', 'Cancelled')` because
-- the two failure modes are not equal. If a status is added later, an
-- exclusion list would silently start counting it — over-counting hides work
-- that is still owed, which is invisible. A positive list would silently stop
-- counting it, which shows up as quantity still owed and gets noticed.
--
-- THREE THINGS MOVE TOGETHER, and the migration is wrong without any of them:
--
--   1. The views, so pending_qty and OTD reflect goods that actually left.
--   2. The quantity ceiling, so "consumes order quantity" keeps exactly ONE
--      definition. Two copies is how the trigger and the view start
--      disagreeing about the same item.
--   3. A NEW guard on the status transition. This is the hole the change
--      opens: with drafts not counted, a draft for 1000 and a dispatch for
--      1000 against a 1000 order are both individually fine, and promoting the
--      draft would take the item to 2000 delivered. The line-level trigger
--      cannot catch that, because promoting a draft touches no line.
--
-- ALL DATE ARITHMETIC STILL CASTS TO Asia/Kolkata. See the header of 0002.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. v_po_item_status — only dispatched challans consume quantity
--
-- CREATE OR REPLACE, so v_otd, v_wip_ageing and v_client_summary keep working:
-- the column list is unchanged.
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
-- 2. v_client_summary — the same rule, in its own dispatch_value CTE
--
-- This one joins dispatch_line directly rather than going through
-- v_po_item_status, so it needs the change too. Missing it would leave a
-- client's dispatched VALUE counting drafts while their pending QUANTITY did
-- not — the kind of disagreement nobody reconciles until a report is queried
-- in a meeting.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 3. The quantity ceiling, brought into line
--
-- Replaces the version from migration 0001. The only change is which challans
-- count toward "already dispatched" — everything else, including the
-- cross-client check from C8 and the row lock, is unchanged.
--
-- ONE definition of "consumes order quantity", shared with the views above. A
-- second copy is how a trigger and a view start disagreeing about the same
-- item, and the symptom is a save being refused for a quantity the screen says
-- is available.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dispatch_line_guard() RETURNS trigger AS $$
DECLARE
  v_ordered          integer;
  v_already          integer;
  v_item_code        text;
  v_item_client      uuid;
  v_dispatch_client  uuid;
  v_dispatch_status  dispatch_status;
BEGIN
  -- Lock the item row first; everything below depends on a stable read.
  SELECT pi.ordered_qty, pi.item_code, po.client_id
    INTO v_ordered, v_item_code, v_item_client
  FROM po_item pi
  JOIN purchase_order po ON po.id = pi.purchase_order_id
  WHERE pi.id = NEW.po_item_id
  FOR UPDATE OF pi;

  IF v_ordered IS NULL THEN
    RAISE EXCEPTION 'Dispatch line references a po_item that does not exist';
  END IF;

  SELECT client_id, status INTO v_dispatch_client, v_dispatch_status
  FROM dispatch WHERE id = NEW.dispatch_id;

  IF v_item_client IS DISTINCT FROM v_dispatch_client THEN
    RAISE EXCEPTION
      'Item % belongs to a different client than this challan. A dispatch cannot mix clients.',
      v_item_code;
  END IF;

  -- A line on a challan that has not gone out cannot overflow the order,
  -- because it consumes nothing yet. The transition guard below is what checks
  -- it, at the moment it starts to count.
  IF v_dispatch_status <> 'Dispatched' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(dl.qty), 0) INTO v_already
  FROM dispatch_line dl
  JOIN dispatch d ON d.id = dl.dispatch_id
  WHERE dl.po_item_id = NEW.po_item_id
    AND dl.id <> NEW.id                -- exclude self when updating
    AND dl.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.status = 'Dispatched';

  IF v_already + NEW.qty > v_ordered THEN
    RAISE EXCEPTION
      'Dispatch quantity exceeds the order for item %: ordered %, already dispatched %, tried to dispatch % (over by %).',
      v_item_code, v_ordered, v_already, NEW.qty,
      (v_already + NEW.qty - v_ordered);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. The new hole, and its guard
--
-- With drafts no longer counted, two challans can each be individually valid
-- and jointly impossible: a draft for 1000 and a dispatch for 1000, against an
-- order of 1000. Promoting the draft would put 2000 against it.
--
-- The line-level trigger cannot see this, because promoting a draft touches no
-- dispatch_line row. So the check runs at the moment a challan STARTS to
-- consume — becoming 'Dispatched', or being restored from a soft delete while
-- already 'Dispatched'.
--
-- Every item on the challan is checked, and the message names the first one
-- that does not fit rather than reporting "something is wrong".
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dispatch_consumption_guard() RETURNS trigger AS $$
DECLARE
  r           record;
  v_ordered   integer;
  v_others    integer;
  v_item_code text;
BEGIN
  FOR r IN
    SELECT dl.po_item_id, SUM(dl.qty)::integer AS qty
    FROM dispatch_line dl
    WHERE dl.dispatch_id = NEW.id
      AND dl.deleted_at IS NULL
    GROUP BY dl.po_item_id
  LOOP
    SELECT pi.ordered_qty, pi.item_code INTO v_ordered, v_item_code
    FROM po_item pi WHERE pi.id = r.po_item_id
    FOR UPDATE OF pi;

    -- Everything ALREADY consuming, excluding this challan.
    SELECT COALESCE(SUM(dl.qty), 0) INTO v_others
    FROM dispatch_line dl
    JOIN dispatch d ON d.id = dl.dispatch_id
    WHERE dl.po_item_id = r.po_item_id
      AND dl.dispatch_id <> NEW.id
      AND dl.deleted_at IS NULL
      AND d.deleted_at IS NULL
      AND d.status = 'Dispatched';

    IF v_others + r.qty > v_ordered THEN
      RAISE EXCEPTION
        'Cannot dispatch challan %: item % would go over its order. Ordered %, already dispatched %, this challan adds % (over by %).',
        NEW.challan_no, v_item_code, v_ordered, v_others, r.qty,
        (v_others + r.qty - v_ordered);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS dispatch_consumption_guard_trg ON dispatch;
--> statement-breakpoint

-- Fires only on the transition INTO consuming, not on every update of a
-- challan that is already dispatched — re-checking an unchanged challan against
-- itself would be wasted work on every remarks edit.
CREATE TRIGGER dispatch_consumption_guard_trg
  BEFORE UPDATE OF status, deleted_at ON dispatch
  FOR EACH ROW
  WHEN (
    (NEW.status = 'Dispatched' AND NEW.deleted_at IS NULL)
    AND NOT (OLD.status = 'Dispatched' AND OLD.deleted_at IS NULL)
  )
  EXECUTE FUNCTION dispatch_consumption_guard();
