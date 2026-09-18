-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- Decision N1: an item may exist before its purchase order does.
--
-- The client's PO often arrives after the work has started — sometimes after
-- it has been dispatched. `purchase_order.po_no` has been nullable since 0000
-- for exactly that, so the schema needs no new table and no new column: an
-- item without a PO is an item under an order whose client number is blank.
-- What this migration adds is the vocabulary for that state and the safety for
-- the day the real PO turns up and the item has to move onto it.
--
-- THREE THINGS, and the migration is incomplete without any of them:
--
--   1. `po_awaited` on v_po_item_status, so "which items are we still owed a
--      PO for?" has ONE definition, in the view, like every other derived fact
--      about an item (non-negotiables 1 and 2 by extension). Imported
--      historical orders are excluded: a paper-book job with no number is not
--      waiting for one, and labelling it as such would send somebody chasing a
--      document that never existed.
--
--   2. A guard on `po_item.purchase_order_id` changing. An item may move
--      between two orders of the SAME client only. Nothing else protects that:
--      the dispatch_line_guard from 0001 checks client agreement when a LINE
--      is written, not when the item under it later changes parent, so a move
--      across clients would leave a challan for NAT carrying MUL's item with
--      no trigger ever having objected (C8 by the back door).
--
--   3. A recompute on the same change. `recompute_for_po_item` follows the
--      item to its NEW order, which leaves the one it came from with a status
--      computed over items it no longer has. The 0006 rule applies — a
--      recompute the application has to remember is a recompute it will
--      forget — so it fires from a trigger on both orders.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. v_po_item_status gains po_awaited
--
-- CREATE OR REPLACE, with the new column LAST: Postgres permits appending to
-- a view's column list in place, and v_otd, v_wip_ageing and v_client_summary
-- select from this by name and keep working. Everything above the new line is
-- verbatim from 0008.
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


-- ---------------------------------------------------------------------------
-- 2. An item moves between orders of ONE client, and only to a live order
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION po_item_move_guard() RETURNS trigger AS $$
DECLARE
  v_old_client uuid;
  v_new_client uuid;
  v_new_deleted timestamptz;
BEGIN
  SELECT client_id INTO v_old_client FROM purchase_order WHERE id = OLD.purchase_order_id;
  SELECT client_id, deleted_at INTO v_new_client, v_new_deleted
    FROM purchase_order WHERE id = NEW.purchase_order_id;

  IF v_new_client IS NULL THEN
    RAISE EXCEPTION 'Item % cannot move to an order that does not exist.', NEW.item_code;
  END IF;

  IF v_new_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Item % cannot move to a removed order.', NEW.item_code;
  END IF;

  IF v_old_client IS DISTINCT FROM v_new_client THEN
    RAISE EXCEPTION
      'Item % belongs to a different client than the order it is being moved to. An item cannot change client — its challans and job cards would still say the old one.',
      NEW.item_code;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_move_guard_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_move_guard_trg
  BEFORE UPDATE OF purchase_order_id ON po_item
  FOR EACH ROW
  WHEN (NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id)
  EXECUTE FUNCTION po_item_move_guard();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. Both orders settle their status after a move
--
-- The order the item LEFT is the one nothing else would recompute: the item's
-- own recompute follows its foreign key, which now points elsewhere.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION po_item_move_recompute() RETURNS trigger AS $$
BEGIN
  PERFORM recompute_purchase_order_status(OLD.purchase_order_id);
  PERFORM recompute_purchase_order_status(NEW.purchase_order_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_move_recompute_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_move_recompute_trg
  AFTER UPDATE OF purchase_order_id ON po_item
  FOR EACH ROW
  WHEN (NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id)
  EXECUTE FUNCTION po_item_move_recompute();
