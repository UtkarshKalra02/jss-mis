-- ===========================================================================
-- DOWN for 0052_petty_cash (section CC).
--
-- Drops both views, the balance function, both tables with their triggers and
-- the direction enum. Nothing existing is restored because nothing existing was
-- changed: 0052 is purely additive, so going down leaves the rest of the schema
-- exactly as it was.
--
-- THIS LOSES THE TIN'S ENTIRE HISTORY, and it is the only copy. Utkarsh
-- confirmed on 20 Nov 2026 that petty cash is not in Busy, which is what made
-- building it legitimate under R1 — and is also what makes this irreversible.
-- Keep the book first:
--
--   SELECT pc.entry_date, pc.direction, pc.amount, h.name AS head,
--          pc.party, pc.purpose, u.name AS recorded_by, pc.deleted_at
--     FROM petty_cash pc
--     LEFT JOIN petty_cash_head h ON h.id = pc.head_id
--     LEFT JOIN app_user u        ON u.id = pc.created_by
--    ORDER BY pc.entry_date, pc.created_at;
--
-- The views are dropped before the tables they read, and the function before
-- nothing — the views depend on it, so it goes after them. CASCADE is NOT used
-- anywhere here: if something outside this migration has come to depend on one
-- of these objects, the drop should fail loudly rather than take that
-- dependency with it.
-- ===========================================================================

DO $$
DECLARE v_n integer; v_bal numeric;
BEGIN
  SELECT count(*), coalesce(petty_cash_balance_on(today_ist()), 0)
    INTO v_n, v_bal
    FROM petty_cash WHERE deleted_at IS NULL;
  RAISE NOTICE
    'down 0052: % live petty cash entry/entries are being destroyed; the book closes at %',
    v_n, v_bal;
END $$;
--> statement-breakpoint

DROP VIEW IF EXISTS v_petty_cash_head_month;
--> statement-breakpoint
DROP VIEW IF EXISTS v_petty_cash_day;
--> statement-breakpoint
DROP FUNCTION IF EXISTS petty_cash_balance_on(date);
--> statement-breakpoint

DROP TRIGGER IF EXISTS petty_cash_no_future_date_trg ON petty_cash;
--> statement-breakpoint
DROP TRIGGER IF EXISTS petty_cash_touch_updated_at_trg ON petty_cash;
--> statement-breakpoint
DROP TRIGGER IF EXISTS petty_cash_head_touch_updated_at_trg ON petty_cash_head;
--> statement-breakpoint
DROP FUNCTION IF EXISTS petty_cash_no_future_date();
--> statement-breakpoint

-- petty_cash before petty_cash_head: the entry points at the head.
DROP TABLE IF EXISTS petty_cash;
--> statement-breakpoint
DROP TABLE IF EXISTS petty_cash_head;
--> statement-breakpoint

DROP TYPE IF EXISTS "public"."petty_cash_direction";
