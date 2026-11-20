-- ===========================================================================
-- DOWN for 0047_job_opening_discipline (section W).
--
-- Drops v_job_opening, working_minutes_between(), the three confirmation
-- columns with their check and index, the confirmation_source enum, and the
-- four working-hours settings.
--
-- LOSES DATA: every recorded confirmation — source, who, when. Keep the list
-- first:
--
--   SELECT id, item_code, confirmation_source, confirmed_by, confirmed_at
--     FROM po_item WHERE confirmed_at IS NOT NULL;
--
-- working_minutes_between() is dropped because 0047 introduced it and nothing
-- that survives this file calls it. If a later migration has come to depend on
-- it, DROP FUNCTION will refuse rather than break that caller, and this file
-- should then be run without the two statements concerned.
--
-- No existing view reads any of this, so there is no chain to rebuild.
-- ===========================================================================

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM po_item WHERE confirmed_at IS NOT NULL;
  RAISE NOTICE 'down 0047: % po_item row(s) are losing their confirmation record', v_n;
END $$;
--> statement-breakpoint

DROP VIEW IF EXISTS v_job_opening;
--> statement-breakpoint
DROP FUNCTION IF EXISTS working_minutes_between(timestamptz, timestamptz);
--> statement-breakpoint
DROP INDEX IF EXISTS "po_item_confirmed_at_idx";
--> statement-breakpoint
ALTER TABLE "po_item" DROP CONSTRAINT IF EXISTS "po_item_confirmation_all_or_none";
--> statement-breakpoint
ALTER TABLE "po_item" DROP COLUMN IF EXISTS "confirmed_at";
--> statement-breakpoint
ALTER TABLE "po_item" DROP COLUMN IF EXISTS "confirmed_by";
--> statement-breakpoint
ALTER TABLE "po_item" DROP COLUMN IF EXISTS "confirmation_source";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."confirmation_source";
--> statement-breakpoint
DELETE FROM "app_setting" WHERE "key" IN (
  'work_day_start_min',
  'work_day_end_min',
  'work_week_off_dow',
  'job_open_target_working_minutes'
);
