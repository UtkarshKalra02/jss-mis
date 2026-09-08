-- ---------------------------------------------------------------------------
-- A delivery may exceed the order. Decision K12.
--
-- Spec 4.5 said SUM(dispatch_line.qty) per po_item <= po_item.ordered_qty, and
-- 0001 enforced it with a trigger. That is no longer the rule. An over-run is
-- ordinary in an offset works — extra sheets are printed to cover make-ready
-- and wastage, and when they come out clean the client is sent the lot — and a
-- system that refuses to record what physically left the building makes the
-- challan disagree with the gate register.
--
-- WHAT THIS DOES NOT CHANGE. `pending_qty` is still ordered minus dispatched
-- and is still computed nowhere but the view (non-negotiable 2); it simply goes
-- NEGATIVE now, which is the honest reading of an over-delivery. Every
-- consumer was already written for it: the PO item closes on
-- `dispatched >= ordered`, v_otd takes `pending_qty <= 0`, and the dispatch,
-- stage-update and job-card worklists all filter `pending_qty > 0`, so an
-- over-delivered item drops off them exactly as a fully delivered one does.
--
-- NO CEILING AT ALL, not a wider one. A tolerance would have been a number
-- nobody has measured, applied to every client and every job, and the moment it
-- refused a genuine 12% over-run somebody would raise it again. The screen
-- warns instead — the same "warn, never block" this screen already applies to
-- dispatching an item that has not reached READY (F2). The cost is stated
-- plainly: a mistyped 10000 for 1000 will now be accepted, will close the
-- order, and will reach OTD. The form says how far over it is before saving,
-- and that is the whole of the defence.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. dispatch_line_guard keeps the client rule and loses the ceiling.
--
-- C8 is untouched and is the reason this trigger still exists: a line's item
-- and its challan must belong to the same client. Both foreign keys can be
-- individually valid while jointly nonsense, and nothing else stops a line on
-- one client's challan pointing at another's item.
--
-- The FOR UPDATE lock goes with the ceiling. It was there to serialise the
-- read-sum-write of the quantity check — two concurrent inserts each seeing
-- "900 of 1000 dispatched", both passing, both committing. With no sum to
-- protect there is nothing for it to serialise, and holding a row lock on
-- po_item for every dispatch line would be contention bought for nothing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dispatch_line_guard() RETURNS trigger AS $$
DECLARE
  v_item_code        text;
  v_item_client      uuid;
  v_dispatch_client  uuid;
BEGIN
  SELECT pi.item_code, po.client_id
    INTO v_item_code, v_item_client
  FROM po_item pi
  JOIN purchase_order po ON po.id = pi.purchase_order_id
  WHERE pi.id = NEW.po_item_id;

  IF v_item_code IS NULL THEN
    RAISE EXCEPTION 'Dispatch line references a po_item that does not exist';
  END IF;

  SELECT client_id INTO v_dispatch_client
  FROM dispatch WHERE id = NEW.dispatch_id;

  IF v_item_client IS DISTINCT FROM v_dispatch_client THEN
    RAISE EXCEPTION
      'Item % belongs to a different client than this challan. A dispatch cannot mix clients.',
      v_item_code;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. dispatch_consumption_guard goes entirely.
--
-- It was added by 0008 to close a hole that only existed because of the
-- ceiling: with drafts no longer consuming order quantity, a draft for 1000 and
-- a dispatch for 1000 against an order of 1000 were each individually valid and
-- jointly impossible, and promoting the draft touched no dispatch_line row for
-- the line-level trigger to catch.
--
-- "Jointly impossible" is exactly what stops being true here. The trigger has
-- no other job — it checks quantity and nothing else — so it is dropped rather
-- than left in place doing a comparison whose failure branch can no longer be
-- reached. A guard that cannot fire is a guard somebody has to read and
-- discount later.
--
-- Drafts still do not consume; that half of 0008 lives in the views and is
-- untouched.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS dispatch_consumption_guard_trg ON dispatch;
--> statement-breakpoint

DROP FUNCTION IF EXISTS dispatch_consumption_guard();
