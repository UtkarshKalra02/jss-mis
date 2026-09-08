-- ---------------------------------------------------------------------------
-- The second half of the rename begun in 0033.
--
-- `description` said description of WHAT, and `expected_qty` implied a forecast
-- the field never held. Their replacements — `item_description` and `qty` —
-- were added in 0033; this drops the originals.
--
-- SAFE ONLY BECAUSE THE TABLE IS EMPTY, which was checked in both databases
-- before 0033 was written: 0 rows in development, 0 in production. On a
-- populated table these two migrations would need an UPDATE between them
-- copying the values across, and this file would be dropping data.
--
-- Kept as its own migration rather than folded into 0033 because drizzle-kit
-- only offers rename detection through an interactive prompt. Generating an
-- additive pass and then a subtractive one keeps drizzle/meta's snapshots
-- describing the schema that actually exists — which a hand-written migration
-- silently does not.
-- ---------------------------------------------------------------------------
ALTER TABLE "enquiry" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "enquiry" DROP COLUMN "expected_qty";
