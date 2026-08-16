-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- Rules that a CHECK constraint cannot express, because each one has to look
-- at sibling rows or at a parent table. Non-negotiable 4 says integrity is
-- enforced at the database, not just in application code — these are the
-- rules that could not be done as column constraints in 0000.
--
-- Each guard also takes a row lock (FOR UPDATE) on the parent before summing.
-- Without it two concurrent inserts can both read "already dispatched 900 of
-- 1000", both pass, and both commit — leaving 1100 dispatched against a 1000
-- order. The lock serialises per item, not globally, so it costs nothing in
-- practice.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. dispatch_line — quantity ceiling and client agreement
--
-- Spec 4.5: SUM(dispatch_line.qty) per po_item <= po_item.ordered_qty.
-- Decision C8: the line's item must belong to the same client as the challan.
-- Both foreign keys can be individually valid while jointly nonsense — nothing
-- else stops a line on NAT's challan pointing at MUL's item.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dispatch_line_guard() RETURNS trigger AS $$
DECLARE
  v_ordered          integer;
  v_already          integer;
  v_item_code        text;
  v_item_client      uuid;
  v_dispatch_client  uuid;
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

  SELECT client_id INTO v_dispatch_client
  FROM dispatch WHERE id = NEW.dispatch_id;

  IF v_item_client IS DISTINCT FROM v_dispatch_client THEN
    RAISE EXCEPTION
      'Item % belongs to a different client than this challan. A dispatch cannot mix clients.',
      v_item_code;
  END IF;

  -- Cancelled and soft-deleted challans do not consume order quantity.
  SELECT COALESCE(SUM(dl.qty), 0) INTO v_already
  FROM dispatch_line dl
  JOIN dispatch d ON d.id = dl.dispatch_id
  WHERE dl.po_item_id = NEW.po_item_id
    AND dl.id <> NEW.id                -- exclude self when updating
    AND dl.deleted_at IS NULL
    AND d.deleted_at IS NULL
    AND d.status <> 'Cancelled';

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

CREATE TRIGGER dispatch_line_guard_trg
  BEFORE INSERT OR UPDATE OF qty, po_item_id, dispatch_id ON dispatch_line
  FOR EACH ROW EXECUTE FUNCTION dispatch_line_guard();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. invoice_line — client agreement (decision C8)
--
-- The invoice and the dispatch line it bills must belong to the same client.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION invoice_line_guard() RETURNS trigger AS $$
DECLARE
  v_line_client     uuid;
  v_invoice_client  uuid;
BEGIN
  SELECT d.client_id INTO v_line_client
  FROM dispatch_line dl
  JOIN dispatch d ON d.id = dl.dispatch_id
  WHERE dl.id = NEW.dispatch_line_id;

  SELECT client_id INTO v_invoice_client
  FROM invoice WHERE id = NEW.invoice_id;

  IF v_line_client IS DISTINCT FROM v_invoice_client THEN
    RAISE EXCEPTION
      'This dispatch line belongs to a different client than the invoice. An invoice cannot bill another client''s delivery.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER invoice_line_guard_trg
  BEFORE INSERT OR UPDATE OF invoice_id, dispatch_line_id ON invoice_line
  FOR EACH ROW EXECUTE FUNCTION invoice_line_guard();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. receipt_allocation — cannot over-allocate (spec 4.6)
--
--   SUM(allocation.amount) per receipt <= receipt.amount
--       The remainder is legitimate: it is on-account credit.
--   SUM(allocation.amount) per invoice <= invoice.total_amount
--       Over-allocating an invoice means the AR ledger is wrong.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION receipt_allocation_guard() RETURNS trigger AS $$
DECLARE
  v_receipt_amount   numeric(14,2);
  v_receipt_no       text;
  v_receipt_alloc    numeric(14,2);
  v_invoice_total    numeric(14,2);
  v_invoice_no       text;
  v_invoice_alloc    numeric(14,2);
BEGIN
  SELECT amount, receipt_no INTO v_receipt_amount, v_receipt_no
  FROM receipt WHERE id = NEW.receipt_id
  FOR UPDATE;

  SELECT total_amount, invoice_no INTO v_invoice_total, v_invoice_no
  FROM invoice WHERE id = NEW.invoice_id
  FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0) INTO v_receipt_alloc
  FROM receipt_allocation
  WHERE receipt_id = NEW.receipt_id
    AND id <> NEW.id
    AND deleted_at IS NULL;

  IF v_receipt_alloc + NEW.amount > v_receipt_amount THEN
    RAISE EXCEPTION
      'Receipt % is over-allocated: receipt is %, already allocated %, tried to allocate a further %.',
      v_receipt_no, v_receipt_amount, v_receipt_alloc, NEW.amount;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_invoice_alloc
  FROM receipt_allocation
  WHERE invoice_id = NEW.invoice_id
    AND id <> NEW.id
    AND deleted_at IS NULL;

  IF v_invoice_alloc + NEW.amount > v_invoice_total THEN
    RAISE EXCEPTION
      'Invoice % would be over-paid: invoice total is %, already allocated %, tried to allocate a further %.',
      v_invoice_no, v_invoice_total, v_invoice_alloc, NEW.amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER receipt_allocation_guard_trg
  BEFORE INSERT OR UPDATE OF amount, receipt_id, invoice_id ON receipt_allocation
  FOR EACH ROW EXECUTE FUNCTION receipt_allocation_guard();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. Append-only enforcement (non-negotiables 1 and 7)
--
-- stage_event is where current_stage comes from. If a row can be edited after
-- the fact, the stage history stops being a history and no OTD dispute can
-- ever be settled. Corrections are made by appending a new event.
--
-- audit_log is the audit trail; an editable audit trail is not one.
--
-- Deliberately NOT applied to the business tables. There, the audit wrapper is
-- the only write path and it exposes no hard delete, so the application
-- physically cannot issue one. Leaving raw DELETE available to a human at psql
-- is an intentional escape hatch for genuine data repair — which, being
-- outside the app, is a decision someone has to make consciously.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only. Rows cannot be updated or deleted; append a correcting row instead.',
    TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER stage_event_append_only_trg
  BEFORE UPDATE OR DELETE ON stage_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

CREATE TRIGGER audit_log_append_only_trg
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. updated_at maintenance
--
-- The audit wrapper sets updated_at on every write, so this is a safety net
-- rather than the mechanism. It exists because a stale updated_at is invisible
-- until you are relying on it to work out what changed and when.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user', 'app_setting', 'client', 'number_series', 'stage',
    'enquiry', 'quotation', 'design', 'design_process', 'purchase_order',
    'po_item', 'job_card', 'dispatch', 'dispatch_line', 'invoice',
    'invoice_line', 'receipt', 'receipt_allocation'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t || '_touch_updated_at_trg', t
    );
  END LOOP;
END $$;
