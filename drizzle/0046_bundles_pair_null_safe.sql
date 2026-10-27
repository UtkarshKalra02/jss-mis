-- ===========================================================================
-- The bundle pairing check let half a pair through (section V).
--
-- Found by tests/bundle-entry.test.ts the same day 0045 was written, which is
-- the only reason it was found at all: the rule looked right, and the screen
-- would never have produced the row that breaks it.
--
-- A CHECK CONSTRAINT PASSES WHEN ITS EXPRESSION IS NULL, not only when it is
-- true. With bundles = 5 and sheets_per_bundle = NULL:
--
--   (bundles IS NULL AND sheets_per_bundle IS NULL)   -> false
--   (bundles > 0 AND sheets_per_bundle > 0 AND ...)   -> true AND NULL -> NULL
--   false OR NULL                                      -> NULL  -> ACCEPTED
--
-- So "5 bundles of nothing" was storable, and it is exactly the row that makes
-- the pair useless — a count with no size says nothing, and the next reader
-- would have had to guess whether the size had been forgotten or the bundles
-- invented.
--
-- The fix is to test for presence explicitly rather than let a comparison
-- against NULL stand in for it. Nothing else changes: both-or-neither, and
-- when both are present they must multiply out to the quantity.
--
-- The job card and press run checks do NOT have this hole and are untouched.
-- Their CASE sends a null bundle down the ELSE branch, where
-- `paper_sheets_per_bundle IS NULL` is a true/false test and never a null one.
--
-- ADDITIVE in effect — it only ever refuses more than before, and no existing
-- row has either column set (verified on both databases before this ran), so
-- nothing is invalidated.
-- ===========================================================================

ALTER TABLE "material_batch" DROP CONSTRAINT IF EXISTS "material_batch_bundles_agree";
--> statement-breakpoint

ALTER TABLE "material_batch" ADD CONSTRAINT "material_batch_bundles_agree"
  CHECK (
    ("bundles" IS NULL AND "sheets_per_bundle" IS NULL)
    OR (
      "bundles" IS NOT NULL AND "sheets_per_bundle" IS NOT NULL
      AND "bundles" > 0 AND "sheets_per_bundle" > 0
      AND "qty_received" = "bundles" * "sheets_per_bundle"
    )
  );
--> statement-breakpoint

ALTER TABLE "material_issue" DROP CONSTRAINT IF EXISTS "material_issue_bundles_agree";
--> statement-breakpoint

ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_bundles_agree"
  CHECK (
    ("bundles" IS NULL AND "sheets_per_bundle" IS NULL)
    OR (
      "bundles" IS NOT NULL AND "sheets_per_bundle" IS NOT NULL
      AND "bundles" > 0 AND "sheets_per_bundle" > 0
      AND "qty" = "bundles" * "sheets_per_bundle"
    )
  );
