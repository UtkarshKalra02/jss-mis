-- ===========================================================================
-- DOWN for 0048_manual_job_close (section X).
--
-- Removes the three manual-close columns, their two checks, their index, their
-- three triggers and the setting, and puts recompute_po_item_status back to
-- the shape 0043 left it in — where nothing but arithmetic can close an item.
--
-- THIS LOSES DATA: every job closed by hand forgets that it was, and who
-- closed it, and why. Worse, it does not reopen them. The status column still
-- reads 'Closed' until something recomputes it, and the next recompute — which
-- no longer knows about manual closes — will set any such item back to 'Open'
-- if it is still short. That is the correct behaviour for the old rules, and it
-- is a change in what the floor sees. Count and keep the list first:
--
--   SELECT id, item_code, close_reason, closed_manually_at
--     FROM po_item WHERE closed_manually_at IS NOT NULL;
--
-- Run 0051's down first. While v_po_item_status still selects
-- closed_manually_at, the column cannot be dropped.
-- ===========================================================================

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM po_item WHERE closed_manually_at IS NOT NULL;
  RAISE NOTICE 'down 0048: % po_item row(s) are losing a manual close', v_n;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_manual_close_recompute_trg ON po_item;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_manual_close_insert_guard_trg ON po_item;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_manual_close_guard_trg ON po_item;
--> statement-breakpoint

DROP FUNCTION IF EXISTS po_item_manual_close_recompute();
--> statement-breakpoint

DROP FUNCTION IF EXISTS po_item_manual_close_insert_guard();
--> statement-breakpoint

DROP FUNCTION IF EXISTS po_item_manual_close_guard();
--> statement-breakpoint

-- recompute_po_item_status as 0043 left it: dispatched >= ordered, or a small
-- residual whose committed month has passed. No manual branch.
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

ALTER TABLE "po_item" DROP CONSTRAINT IF EXISTS "po_item_close_reason_not_blank";
--> statement-breakpoint

ALTER TABLE "po_item" DROP CONSTRAINT IF EXISTS "po_item_manual_close_all_or_none";
--> statement-breakpoint

DROP INDEX IF EXISTS "po_item_closed_manually_at_idx";
--> statement-breakpoint

ALTER TABLE "po_item" DROP COLUMN IF EXISTS "close_reason";
--> statement-breakpoint

ALTER TABLE "po_item" DROP COLUMN IF EXISTS "closed_by";
--> statement-breakpoint

ALTER TABLE "po_item" DROP COLUMN IF EXISTS "closed_manually_at";
--> statement-breakpoint

DELETE FROM "app_setting" WHERE "key" = 'manual_close_min_days_after_po';
