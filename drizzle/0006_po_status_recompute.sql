-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- Makes decision B5 real.
--
-- purchase_order.status and po_item.status are derived values that are STORED,
-- which looks like a violation of non-negotiables 1 and 2 and is not: they are
-- filtered and indexed constantly, and 'Cancelled' is a human decision that
-- cannot be derived from dispatch quantities at all. The safeguard B5 promised
-- is that only two writers may touch them — the recompute function, and the
-- explicit Cancel action.
--
-- Until this migration that safeguard was a comment. Any form, any script, any
-- psql session could set a status to whatever it liked, and nothing would
-- notice. Now the database refuses, on the same reasoning that put the dispatch
-- quantity ceiling in a trigger rather than in the application: a rule that
-- lives only in TypeScript is a rule the import script does not have.
--
-- Four things land together, because each is incomplete without the others:
--
--   1. A write lock on both status columns, keyed on a transaction-local
--      setting that only the two sanctioned writers turn on.
--   2. The recompute function itself, plus AFTER triggers so it cannot be
--      forgotten at a call site.
--   3. The reverse quantity guard — ordered_qty may not drop below what has
--      already been dispatched.
--   4. The view changes that make a null committed_date safe (F8, with 0005).
--
-- A NOTE ON AUDIT ROWS. The recompute writes status, and non-negotiable 3 says
-- every write is audited — so it writes its own audit_log row, attributed to
-- the SYSTEM user (C4), inside the same transaction as the change. Volume is
-- not a concern: the functions only write when the value actually differs, so
-- a nightly sweep over unchanged rows logs nothing, and an item transitions
-- Open -> Closed roughly once in its life.
--
-- These rows carry ONLY the status field in before/after, not a whole-row
-- snapshot like the ones src/db/audit.ts writes. That is deliberate rather
-- than lazy: the wrapper serialises JavaScript objects and so uses camelCase
-- keys, while to_jsonb() here would produce snake_case ones. A partial object
-- is obviously a delta and cannot be mistaken for a snapshot in the wrong
-- shape.
--
-- ALL DATE ARITHMETIC HERE CASTS TO Asia/Kolkata, via today_ist(). See the
-- header of 0002 for why that is not optional.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Views: a null committed_date must not become a silent OTD entry (F8)
--
-- CREATE OR REPLACE rather than DROP: v_otd, v_wip_ageing and v_client_summary
-- all depend on v_po_item_status, and the column list is unchanged, so
-- replacing in place leaves the dependents intact.
--
-- The important part is that is_overdue and is_at_risk become FALSE for a null
-- committed date, not NULL. `WHERE is_overdue` would drop a NULL row silently,
-- which happens to be right, but `WHERE NOT is_overdue` would ALSO drop it —
-- and that one is wrong. Three-valued logic makes a row that is absent from
-- both sides of a filter, which is precisely the kind of bug nobody finds by
-- reading the screen.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_po_item_status AS
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
  -- An item with NO committed date cannot be overdue — there is nothing to be
  -- late against (F8).
  (
    pi.committed_date IS NOT NULL
    AND pi.committed_date < today_ist()
    AND pi.ordered_qty - COALESCE(dsp.dispatched_qty, 0) > 0
    AND pi.status = 'Open'
  )                                                        AS is_overdue,

  -- At risk (decision B3): committed within the configured window and not yet
  -- READY. This is the DASHBOARD rule. The other at-risk signal — an item
  -- sitting in one stage past its target hours — lives in v_wip_ageing.
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


-- An item with no committed date is EXCLUDED from OTD entirely (F8). It must
-- never count as met and never count as missed. Counting it as on time would
-- inflate the headline number with jobs nobody ever made a promise about;
-- counting it as late would punish the factory for a record that was never
-- kept. It is not a delivery-performance data point in either direction.
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
WHERE v.pending_qty <= 0
  AND v.dispatched_qty > 0
  AND v.status <> 'Cancelled'
  AND v.committed_date IS NOT NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. The write lock on the two status columns (decision B5)
--
-- Keyed on a transaction-local setting. `set_config(..., is_local := true)`
-- reverts at commit or rollback and is safe under a connection pooler in
-- transaction mode, which a session-level SET would not be.
--
-- current_setting(..., true) returns NULL rather than raising when the setting
-- has never been set, which is the normal case: the door is shut by default and
-- has to be deliberately opened.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_derived_status() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('jss.allow_status_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION
      '%.status is derived (decision B5) and cannot be set directly. It is written only by the recompute function and by the Cancel action; no form may write it. Attempted value: %.',
      TG_TABLE_NAME, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- UPDATE: fires only when status is actually in the SET list AND actually
-- changes, so an ordinary edit that happens to round-trip the column is not
-- rejected for no reason.
DROP TRIGGER IF EXISTS po_item_status_guard_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_status_guard_trg
  BEFORE UPDATE OF status ON po_item
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION guard_derived_status();
--> statement-breakpoint

DROP TRIGGER IF EXISTS purchase_order_status_guard_trg ON purchase_order;
--> statement-breakpoint

CREATE TRIGGER purchase_order_status_guard_trg
  BEFORE UPDATE OF status ON purchase_order
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION guard_derived_status();
--> statement-breakpoint

-- INSERT: creating a row is allowed to leave status at its 'Open' default and
-- nothing else. Otherwise a script could sidestep the whole lock by inserting
-- rows that are born 'Closed'. The historical import does not need this — it
-- inserts Open items and lets the dispatch lines recompute them.
DROP TRIGGER IF EXISTS po_item_status_insert_guard_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_status_insert_guard_trg
  BEFORE INSERT ON po_item
  FOR EACH ROW WHEN (NEW.status <> 'Open')
  EXECUTE FUNCTION guard_derived_status();
--> statement-breakpoint

DROP TRIGGER IF EXISTS purchase_order_status_insert_guard_trg ON purchase_order;
--> statement-breakpoint

CREATE TRIGGER purchase_order_status_insert_guard_trg
  BEFORE INSERT ON purchase_order
  FOR EACH ROW WHEN (NEW.status <> 'Open')
  EXECUTE FUNCTION guard_derived_status();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. The recompute itself
--
-- Both functions read dispatched_qty from v_po_item_status rather than
-- re-summing dispatch_line. That is deliberate and slightly slower: the rules
-- about which challans consume order quantity (not soft-deleted, not
-- Cancelled) then have exactly ONE definition. A second copy here would drift
-- from the view the first time somebody changed one of them, and the symptom
-- would be a status column disagreeing with the pending quantity displayed
-- next to it.
--
-- Both save and restore the previous value of the write-lock setting rather
-- than forcing it off afterwards, so a recompute running inside a Cancel does
-- not slam the door on the Cancel that is still in progress.
--
-- 'Cancelled' is never derived away, in either function. It is a human
-- decision, and dispatch quantities have no opinion about it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION recompute_po_item_status(p_po_item_id uuid) RETURNS void AS $$
DECLARE
  v_prev       text;
  v_ordered    integer;
  v_dispatched integer;
  v_status     po_item_status;
  v_new        po_item_status;
BEGIN
  SELECT ordered_qty, dispatched_qty, status
    INTO v_ordered, v_dispatched, v_status
  FROM v_po_item_status
  WHERE po_item_id = p_po_item_id;

  -- No row means deleted, or its PO is. Nothing to recompute.
  IF NOT FOUND THEN RETURN; END IF;
  IF v_status = 'Cancelled' THEN RETURN; END IF;

  v_new := CASE WHEN v_dispatched >= v_ordered THEN 'Closed' ELSE 'Open' END;

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
      jsonb_build_object('status', v_new)
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION recompute_purchase_order_status(p_purchase_order_id uuid)
RETURNS void AS $$
DECLARE
  v_prev        text;
  v_status      purchase_order_status;
  v_items       integer;
  v_closed      integer;
  v_dispatching integer;
  v_new         purchase_order_status;
BEGIN
  SELECT status INTO v_status
  FROM purchase_order
  WHERE id = p_purchase_order_id AND deleted_at IS NULL;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_status = 'Cancelled' THEN RETURN; END IF;

  -- Cancelled ITEMS are excluded from the arithmetic: a PO whose remaining
  -- live items are all delivered is Closed, whether or not somebody cancelled
  -- one of the others along the way.
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE status = 'Closed')::integer,
    COUNT(*) FILTER (WHERE dispatched_qty > 0)::integer
  INTO v_items, v_closed, v_dispatching
  FROM v_po_item_status
  WHERE purchase_order_id = p_purchase_order_id
    AND status <> 'Cancelled';

  v_new := CASE
    -- A PO with no live items yet is Open, not Closed. Otherwise a header
    -- saved a moment before its rows would flicker straight to Closed.
    WHEN v_items = 0                THEN 'Open'
    WHEN v_closed = v_items         THEN 'Closed'
    WHEN v_dispatching > 0          THEN 'Partially Dispatched'
    ELSE 'Open'
  END;

  IF v_new IS DISTINCT FROM v_status THEN
    v_prev := COALESCE(current_setting('jss.allow_status_write', true), 'off');
    PERFORM set_config('jss.allow_status_write', 'on', true);
    UPDATE purchase_order SET status = v_new WHERE id = p_purchase_order_id;
    PERFORM set_config('jss.allow_status_write', v_prev, true);

    INSERT INTO audit_log (table_name, record_id, action, changed_by, before, after)
    VALUES (
      'purchase_order', p_purchase_order_id, 'UPDATE',
      '00000000-0000-0000-0000-000000000000',
      jsonb_build_object('status', v_status),
      jsonb_build_object('status', v_new)
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- The item and then the header it belongs to, in that order — the header's
-- answer depends on the item's.
CREATE OR REPLACE FUNCTION recompute_for_po_item(p_po_item_id uuid) RETURNS void AS $$
DECLARE
  v_po_id uuid;
BEGIN
  PERFORM recompute_po_item_status(p_po_item_id);

  SELECT purchase_order_id INTO v_po_id FROM po_item WHERE id = p_po_item_id;
  IF FOUND THEN
    PERFORM recompute_purchase_order_status(v_po_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. Triggers, so the recompute cannot be forgotten
--
-- The spec says status is derived "nightly + on write". Doing the on-write
-- half in the application would mean every future screen that touches a
-- dispatch has to remember to call it, and the one that forgets produces a
-- wrong status that looks exactly like a right one. Here it is not a call site
-- at all.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dispatch_line_recompute() RETURNS trigger AS $$
BEGIN
  -- Soft-deleting a line is an UPDATE of deleted_at, so it arrives here too.
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND NEW.po_item_id IS DISTINCT FROM OLD.po_item_id) THEN
    PERFORM recompute_for_po_item(OLD.po_item_id);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    PERFORM recompute_for_po_item(NEW.po_item_id);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS dispatch_line_recompute_trg ON dispatch_line;
--> statement-breakpoint

CREATE TRIGGER dispatch_line_recompute_trg
  AFTER INSERT OR UPDATE OR DELETE ON dispatch_line
  FOR EACH ROW EXECUTE FUNCTION dispatch_line_recompute();
--> statement-breakpoint

-- Cancelling or soft-deleting a whole challan changes the dispatched quantity
-- of every item on it, without touching a single dispatch_line row.
CREATE OR REPLACE FUNCTION dispatch_recompute() RETURNS trigger AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT po_item_id FROM dispatch_line WHERE dispatch_id = NEW.id
  LOOP
    PERFORM recompute_for_po_item(r.po_item_id);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS dispatch_recompute_trg ON dispatch;
--> statement-breakpoint

CREATE TRIGGER dispatch_recompute_trg
  AFTER UPDATE OF status, deleted_at ON dispatch
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status
        OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
  EXECUTE FUNCTION dispatch_recompute();
--> statement-breakpoint

-- Reducing an order can complete it: 1000 ordered with 400 dispatched is Open,
-- but corrected to 400 ordered it is Closed.
CREATE OR REPLACE FUNCTION po_item_qty_recompute() RETURNS trigger AS $$
BEGIN
  PERFORM recompute_for_po_item(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_qty_recompute_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_qty_recompute_trg
  AFTER UPDATE OF ordered_qty ON po_item
  FOR EACH ROW WHEN (NEW.ordered_qty IS DISTINCT FROM OLD.ordered_qty)
  EXECUTE FUNCTION po_item_qty_recompute();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. The reverse quantity guard
--
-- 0001 stops SUM(dispatch_line.qty) exceeding ordered_qty by growing the
-- dispatch side. Nothing stopped the same violation being reached from the
-- other direction: reducing ordered_qty below what has already gone out.
--
-- That path drives pending_qty NEGATIVE, which is not a validation message
-- anywhere — it is a minus sign appearing in a column on the Item Tracker, and
-- an item that silently drops out of every "still owed" filter.
--
-- Correcting an over-entered order is legitimate. The challans have to be
-- fixed first, which is the point: the correction is made where the wrong
-- number actually is.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION po_item_qty_guard() RETURNS trigger AS $$
DECLARE
  v_dispatched integer;
BEGIN
  SELECT COALESCE(dispatched_qty, 0) INTO v_dispatched
  FROM v_po_item_status WHERE po_item_id = NEW.id;

  IF COALESCE(v_dispatched, 0) > NEW.ordered_qty THEN
    RAISE EXCEPTION
      'Cannot reduce the order for item % to %: % have already been dispatched. Cancel or correct the challans first.',
      NEW.item_code, NEW.ordered_qty, v_dispatched;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS po_item_qty_guard_trg ON po_item;
--> statement-breakpoint

CREATE TRIGGER po_item_qty_guard_trg
  BEFORE UPDATE OF ordered_qty ON po_item
  FOR EACH ROW WHEN (NEW.ordered_qty < OLD.ordered_qty)
  EXECUTE FUNCTION po_item_qty_guard();
