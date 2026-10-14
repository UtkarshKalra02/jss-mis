-- ===========================================================================
-- Small residuals close themselves once the month turns (section T).
--
-- Asked for by Utkarsh on 14 Oct 2026: "if some quantity less than 1500 is
-- pending, the order should close automatically the next month." Anchored on
-- the COMMITTED DATE and counted in OTD, both his call when asked.
--
-- The case it is for: 10,000 ordered, 8,900 delivered, 1,100 still owed. That
-- 1,100 is never going to be printed, and until now it sat on the pending list
-- for ever. This retires it without anybody having to remember to.
--
-- WHAT IT IS NOT. It never closes an order nobody made. The rule requires
-- `dispatched > 0`, so it only ever retires a RESIDUAL of something already
-- part-delivered. Without that guard an order of 1,200 would close itself the
-- month after it was placed, having never been printed — the opposite of what
-- this is for, and the quietest possible way to lose a job.
--
-- THE MONTH TEST uses the committed date's month against today's, both in IST
-- (C10). An item committed in October with 1,100 pending closes on 1 November,
-- whenever the nightly recompute first runs after midnight. Something
-- committed this month stays open however small its residual, because the
-- promise has not come due yet.
--
-- NO NEW CRON. The nightly recompute (recomputeAllStatuses, 19:30 IST) and the
-- dispatch triggers both already call this function, so the rule applies from
-- both directions with no new call site to forget. That is the same reasoning
-- section 4 of 0006 gives for the triggers.
--
-- THE THRESHOLD IS A SETTING, not a constant. 1500 is a judgement about what
-- is worth re-printing and that judgement will change; app_setting_int() keeps
-- it tunable from the Admin screen without a deploy, exactly as
-- at_risk_window_days is (B3). The default in the function matches the seeded
-- row, so deleting the setting degrades to the same behaviour rather than
-- closing everything or nothing.
--
-- THE AUDIT ROW SAYS WHY. A short close writes `reason: 'short_closed'`
-- alongside the status, because `Closed` now means two different things —
-- "delivered in full" and "written off as too small to finish" — and the
-- difference is invisible in the column itself. (It is also derivable at any
-- time as `status = 'Closed' AND pending_qty > 0`, which is why no column is
-- added for it: non-negotiable 2 says pending is computed, and what follows
-- from pending should be computed too.)
--
-- OTD: v_otd required `pending_qty <= 0`, so a short-closed item would have
-- vanished from the headline number along with the delivery that really did
-- happen. Utkarsh's call is to count it, which is also the honest answer: the
-- goods went out on a date, and that date is either on or after what was
-- promised. The row now admits anything Closed with at least one dispatch, and
-- judges it on its last dispatch date exactly as before.
--
-- ADDITIVE. Both objects are CREATE OR REPLACE and v_otd keeps its column list
-- unchanged, so v_client_summary continues to read it. Migrate first, deploy
-- after; nothing in the application needs to change for the rule to take
-- effect.
-- ===========================================================================

INSERT INTO app_setting (key, value, description)
VALUES (
  'auto_close_pending_below',
  '1500',
  'A part-delivered item with less than this many pieces still pending closes itself once its committed date falls in an earlier month. Never applies to an item with no dispatches. Set high to retire more, set to 0 to switch the rule off entirely.'
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint


CREATE OR REPLACE FUNCTION recompute_po_item_status(p_po_item_id uuid) RETURNS void AS $$
DECLARE
  v_prev       text;
  v_ordered    integer;
  v_dispatched integer;
  v_pending    integer;
  v_committed  date;
  v_status     po_item_status;
  v_new        po_item_status;
  v_short      boolean := false;
BEGIN
  SELECT ordered_qty, dispatched_qty, pending_qty, committed_date, status
    INTO v_ordered, v_dispatched, v_pending, v_committed, v_status
  FROM v_po_item_status
  WHERE po_item_id = p_po_item_id;

  -- No row means deleted, or its PO is. Nothing to recompute.
  IF NOT FOUND THEN RETURN; END IF;
  IF v_status = 'Cancelled' THEN RETURN; END IF;

  IF v_dispatched >= v_ordered THEN
    v_new := 'Closed';
  ELSIF v_dispatched > 0
    AND v_pending > 0
    AND v_pending < app_setting_int('auto_close_pending_below', 1500)
    AND v_committed IS NOT NULL
    AND date_trunc('month', v_committed) < date_trunc('month', today_ist())
  THEN
    -- A residual too small to re-print, on a promise whose month has passed.
    v_new   := 'Closed';
    v_short := true;
  ELSE
    v_new := 'Open';
  END IF;

  IF v_new IS DISTINCT FROM v_status THEN
    v_prev := COALESCE(current_setting('jss.allow_status_write', true), 'off');
    PERFORM set_config('jss.allow_status_write', 'on', true);
    UPDATE po_item SET status = v_new WHERE id = p_po_item_id;
    PERFORM set_config('jss.allow_status_write', v_prev, true);

    INSERT INTO audit_log (table_name, record_id, action, changed_by, before, after)
    VALUES (
      'po_item', p_po_item_id, 'UPDATE',
      '00000000-0000-0000-0000-000000000000',
      jsonb_build_object('status', v_status),
      CASE
        WHEN v_short THEN jsonb_build_object(
          'status', v_new,
          'reason', 'short_closed',
          'pendingWrittenOff', v_pending
        )
        ELSE jsonb_build_object('status', v_new)
      END
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint


-- An item with no committed date is still EXCLUDED from OTD entirely (F8), and
-- a Cancelled one still never counts. What changes is that "fulfilled" no
-- longer means "nothing pending": an item the factory stopped short on was
-- still delivered, on a date, and that date is the one OTD judges.
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
