-- ===========================================================================
-- DOWN for 0049_job_card_ups (section Y).
--
-- Drops job_card.ups and its check.
--
-- LOSES DATA: every ups figure typed on a job card. The pieces-per-sheet
-- figure derived from it was never stored, so nothing else has to be undone.
-- Count them first:
--
--   SELECT count(*) FROM job_card WHERE ups IS NOT NULL;
--
-- No view reads the column, so there is no dependency chain to rebuild.
-- ===========================================================================

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM job_card WHERE ups IS NOT NULL;
  RAISE NOTICE 'down 0049: % job_card row(s) are losing their ups figure', v_n;
END $$;
--> statement-breakpoint

ALTER TABLE "job_card" DROP CONSTRAINT IF EXISTS "job_card_ups_positive";
--> statement-breakpoint
ALTER TABLE "job_card" DROP COLUMN IF EXISTS "ups";
