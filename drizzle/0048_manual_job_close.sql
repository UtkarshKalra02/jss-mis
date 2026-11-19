-- ===========================================================================
-- Manual job close (section X) — ending a job that will never be completed.
--
-- Asked for by Utkarsh on 18 Nov 2026: "There should be an option to manually
-- close a job as well, if needed only by the DEO and admin and owner", then
-- fenced the same day: "only closable after a month of PO Date".
--
-- CLOSED IS NOT CANCELLED, and the difference is the whole point:
--   Cancelled — the order went away. It never happened.
--   Closed    — we delivered what we are going to deliver. The shortfall is
--               accepted and written off. The job happened, late or short.
-- Cancel already exists. This is the other one.
--
-- WHY THIS CANNOT BE JUST A STATUS WRITE. po_item.status is derived (B5), and
-- recompute_po_item_status() recomputes it from dispatch quantities on every
-- dispatch edit and again nightly. It returns early for 'Cancelled' and for
-- nothing else. An item set to 'Closed' by hand while pending_qty > 0 would
-- therefore be flipped straight back to 'Open' by the next recompute —
-- overnight at the very latest, and silently. A manual close has to be a
-- STORED FACT that the recompute respects, exactly as 'Cancelled' is.
--
-- THE INVARIANT IS NOT BENT. Status remains derived, and the two sanctioned
-- writers are still the only writers. What changes is what it is derived FROM:
-- the dispatched quantity and this fact. That is precisely what 'Cancelled'
-- has always been.
--
-- ALL OR NONE. The three columns travel together — a close with no reason, or
-- a reason with no closer, is not a record of a decision. Every term states
-- IS NULL or IS NOT NULL explicitly, because a CHECK whose expression
-- evaluates to NULL PASSES: a bare AND chain would accept partial data (V2).
-- The reason must also be non-blank, or the required field is satisfied by a
-- space bar.
--
-- THE FENCE. A job cannot be closed by hand until manual_close_min_days_after_po
-- days after its PO date — default 30, Utkarsh's "a month", in app_setting so
-- it is correctable without a deploy. Enforced by a TRIGGER, not by the form:
-- the form is the key, the trigger is the lock, and a script gets the same
-- refusal a screen does. A CHECK constraint cannot express it at all, because
-- the PO date lives on another table.
--
-- WHY A FENCE AT ALL. Without one, "close" is a way to make a job that is
-- going badly stop appearing on the overdue list on the day it starts going
-- badly. A month of PO date means the job has had a real life first.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO. v_otd admits only items with
-- pending_qty <= 0, so a manually closed job carrying a shortfall is absent
-- from on-time delivery altogether — neither on time nor late, just gone from
-- both halves of the fraction. Closing an old late job therefore still
-- improves OTD without a delivery changing. That is an OPEN DECISION, raised
-- with Utkarsh on 18 Nov 2026 and not yet settled, recorded in
-- docs/DECISIONS.md section X. It is not yet live: no item has ever been
-- manually closed, so v_otd returns exactly the same rows after this migration
-- as before it, which is what the SOP brief's acceptance check requires.
--
-- NOTHING EXISTING CHANGES. Three nullable columns, one app_setting row, one
-- new trigger that fires only on the act of closing, and one function body
-- replaced with a superset of itself. Every other view, trigger and screen
-- reads exactly as it did.
-- ===========================================================================

ALTER TABLE "po_item" ADD COLUMN "closed_manually_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "po_item" ADD COLUMN "closed_by" uuid REFERENCES "app_user"("id");
--> statement-breakpoint
ALTER TABLE "po_item" ADD COLUMN "close_reason" text;
--> statement-breakpoint

ALTER TABLE "po_item" ADD CONSTRAINT "po_item_manual_close_all_or_none" CHECK (
  ("closed_manually_at" IS NULL
   AND "closed_by" IS NULL
   AND "close_reason" IS NULL)
  OR
  ("closed_manually_at" IS NOT NULL
   AND "closed_by" IS NOT NULL
   AND "close_reason" IS NOT NULL)
);
--> statement-breakpoint

-- A required reason that accepts ' ' is not a required reason.
ALTER TABLE "po_item" ADD CONSTRAINT "po_item_close_reason_not_blank" CHECK (
  "close_reason" IS NULL OR btrim("close_reason") <> ''
);
--> statement-breakpoint

CREATE INDEX "po_item_closed_manually_at_idx" ON "po_item" ("closed_manually_at");
--> statement-breakpoint

INSERT INTO "app_setting" ("key", "value", "description") VALUES
  ('manual_close_min_days_after_po', '30',
   'A job cannot be closed by hand until this many days after its PO date. Utkarsh, 18 Nov 2026: "only closable after a month of PO Date". Raise it to make manual closing rarer; it can never be set to zero in effect, because the trigger reads it on every close.')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- The fence, as a lock rather than a key.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION po_item_manual_close_guard() RETURNS trigger AS $$
DECLARE
  v_po_date  date;
  v_min_days integer;
  v_earliest date;
BEGIN
  v_min_days := app_setting_int('manual_close_min_days_after_po', 30);

  SELECT po_date INTO v_po_date
  FROM purchase_order
  WHERE id = NEW.purchase_order_id;

  -- purchase_order.po_date is NOT NULL and purchase_order_id is NOT NULL, so
  -- this is unreachable through the application. It is here because a missing
  -- date must refuse the close rather than let v_earliest go NULL and compare
  -- false, which would wave every close through.
  IF v_po_date IS NULL THEN
    RAISE EXCEPTION
      'Cannot close this job by hand: its purchase order has no date to measure the waiting period from.';
  END IF;

  v_earliest := v_po_date + v_min_days;

  IF today_ist() < v_earliest THEN
    RAISE EXCEPTION
      'A job cannot be closed by hand until % days after its PO date. PO date %, so the earliest is %. If the order went away rather than fell short, cancel it instead.',
      v_min_days, v_po_date, v_earliest;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Fires only on the ACT of closing: null -> not null. Reopening (not null ->
-- null) is never fenced, and an ordinary edit that leaves the column alone
-- does not pay for the lookup.
DROP TRIGGER IF EXISTS po_item_manual_close_guard_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_manual_close_guard_trg
  BEFORE UPDATE OF closed_manually_at ON po_item
  FOR EACH ROW WHEN (NEW.closed_manually_at IS NOT NULL AND OLD.closed_manually_at IS NULL)
  EXECUTE FUNCTION po_item_manual_close_guard();
--> statement-breakpoint

-- A job cannot be BORN closed. Without this, the fence is sidestepped by
-- inserting the row already closed — the same hole the status insert guard
-- closes for 'Closed' itself (0006).
CREATE OR REPLACE FUNCTION po_item_manual_close_insert_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'A job cannot be created already closed. Create it, then close it once it is at least % days past its PO date.',
    app_setting_int('manual_close_min_days_after_po', 30);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_manual_close_insert_guard_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_manual_close_insert_guard_trg
  BEFORE INSERT ON po_item
  FOR EACH ROW WHEN (NEW.closed_manually_at IS NOT NULL)
  EXECUTE FUNCTION po_item_manual_close_insert_guard();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- recompute_po_item_status — now respects a manual close.
--
-- Replaced wholesale rather than patched, because this is the function the
-- whole status invariant rests on and a reader should see all of it in one
-- place. The only change from 0043 is the v_manual lookup and the branch that
-- reads it. Everything else — the Cancelled early return, the auto-close
-- residual rule (T1), the audit row, the write lock — is character for
-- character what 0043 established.
--
-- ORDER OF THE BRANCHES MATTERS. The manual close is tested FIRST, before
-- 'dispatched >= ordered'. Both produce 'Closed', so the outcome is the same
-- either way today; putting it first says plainly that a human decision is not
-- re-litigated by arithmetic, and keeps it that way if a later branch is added.
-- ---------------------------------------------------------------------------

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
  v_manual     boolean := false;
BEGIN
  SELECT ordered_qty, dispatched_qty, pending_qty, committed_date, status
    INTO v_ordered, v_dispatched, v_pending, v_committed, v_status
  FROM v_po_item_status
  WHERE po_item_id = p_po_item_id;

  -- No row means deleted, or its PO is. Nothing to recompute.
  IF NOT FOUND THEN RETURN; END IF;
  IF v_status = 'Cancelled' THEN RETURN; END IF;

  SELECT closed_manually_at IS NOT NULL
    INTO v_manual
  FROM po_item
  WHERE id = p_po_item_id;

  IF v_manual THEN
    -- A person decided this job is over. Arithmetic does not overturn it.
    v_new := 'Closed';
  ELSIF v_dispatched >= v_ordered THEN
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
        WHEN v_manual THEN jsonb_build_object(
          'status', v_new,
          'reason', 'manually_closed'
        )
        ELSE jsonb_build_object('status', v_new)
      END
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- Recompute when the close is written or cleared.
--
-- WITHOUT THIS THE WHOLE FEATURE IS A COLUMN THAT CHANGES NOTHING. The
-- recompute reads these columns now, but nothing told it to run: its AFTER
-- triggers sit on dispatch_line, dispatch and po_item.ordered_qty, and none of
-- those fire when a close is recorded. The item would keep its old status
-- until the next dispatch edit or the nightly sweep — so a job would read
-- 'Open' with a close already stored against it.
--
-- It was the server action calling recomputeForPoItem() that hid this. That
-- call is the kind po-status.ts warns about: "the recompute half needs no help
-- from here at all... there is no call site to forget". A second entry point —
-- a script, a correction at psql, an import — would have forgotten it. Caught
-- by tests/manual-close.test.ts, which asserted the status rather than the
-- columns.
--
-- Mirrors po_item_qty_recompute (0006) exactly: same AFTER UPDATE OF shape,
-- same IS DISTINCT FROM guard, same RETURN NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION po_item_manual_close_recompute() RETURNS trigger AS $$
BEGIN
  PERFORM recompute_for_po_item(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_manual_close_recompute_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_manual_close_recompute_trg
  AFTER UPDATE OF closed_manually_at ON po_item
  FOR EACH ROW WHEN (NEW.closed_manually_at IS DISTINCT FROM OLD.closed_manually_at)
  EXECUTE FUNCTION po_item_manual_close_recompute();
