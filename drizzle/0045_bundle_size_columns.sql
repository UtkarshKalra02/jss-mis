-- ===========================================================================
-- Bundle sizes, on the card and in the store (section V).
--
-- The columns and the rules for the 'Bundle' value added in 0044. Separate
-- because Postgres will not let a new enum value be used in the transaction
-- that creates it, and these constraints name it.
--
-- J18'S OBJECTION IS ANSWERED RATHER THAN IGNORED. What it feared was two
-- sources for one number, drifting apart. There is still exactly one source,
-- per row:
--   Packet / Ream / Gross -> the fixed table in paper.ts, and
--                            paper_sheets_per_bundle MUST be null
--   Bundle                -> the typed column, which MUST be present
-- Both halves are checks, so neither contradictory state can be written at
-- all. A 'Packet' carrying a size of 460 is not a row this database will hold.
--
-- THE STORE KEEPS ITS LEDGER IN SHEETS. qty_received and qty stay the atomic
-- figure every stock number, the reorder calculation and the Q2 reset depend
-- on: 5 bundles of 460 is 2,300 sheets, and 2,300 is what the ledger holds.
-- Bundles are HOW IT WAS COUNTED, recorded beside the total — and the check
-- makes them unable to disagree with it. Receiving "5 bundles of 460" against
-- a total of 2,000 is a typo somebody would otherwise find by counting a
-- shelf, months later.
--
-- Loose paper is untouched: both fields stay null and the quantity is typed as
-- it always was. That is why the pair is all-or-nothing rather than required.
--
-- NOTHING DERIVED IS STORED. A card's sheet counts are still computed by
-- paperCount() wherever they appear (non-negotiable 2).
--
-- ADDITIVE. Every column is nullable and every constraint passes for a row
-- carrying none of them, so all existing data is valid unchanged — verified
-- against production before this ran: 62 job cards, 3 press runs, 545 batches
-- and 607 issues, none of which has any of these fields. Migrate first, deploy
-- after.
-- ===========================================================================

ALTER TABLE "job_card" ADD COLUMN IF NOT EXISTS "paper_sheets_per_bundle" integer;
--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN IF NOT EXISTS "paper_sheets_per_bundle" integer;
--> statement-breakpoint

ALTER TABLE "material_batch" ADD COLUMN IF NOT EXISTS "bundles" integer;
--> statement-breakpoint
ALTER TABLE "material_batch" ADD COLUMN IF NOT EXISTS "sheets_per_bundle" integer;
--> statement-breakpoint

ALTER TABLE "material_issue" ADD COLUMN IF NOT EXISTS "bundles" integer;
--> statement-breakpoint
ALTER TABLE "material_issue" ADD COLUMN IF NOT EXISTS "sheets_per_bundle" integer;
--> statement-breakpoint


-- The pairing rules live here rather than in form validation because a form is
-- only one of the ways a row arrives — the importer and a script are others —
-- and the rule is about the row, not about the screen.
--
-- NOTE THE ::text CAST, which is load-bearing. drizzle-kit applies all pending
-- migrations in ONE transaction, and Postgres refuses to let an enum value be
-- used in the transaction that added it — so naming 'Bundle' as an enum
-- literal here fails whenever 0044 has not already been committed, which is
-- the situation on every database that has not yet run either. Comparing the
-- column as text asks nothing of the enum catalogue and applies cleanly from
-- a standing start. The first version of this failed exactly that way, and
-- drizzle-kit reported it by exiting 1 and printing nothing at all.
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_sheets_per_bundle_pairing"
  CHECK (
    CASE WHEN "paper_bundle"::text = 'Bundle'
      THEN "paper_sheets_per_bundle" IS NOT NULL AND "paper_sheets_per_bundle" > 0
      ELSE "paper_sheets_per_bundle" IS NULL
    END
  );
--> statement-breakpoint

ALTER TABLE "press_run" ADD CONSTRAINT "press_run_sheets_per_bundle_pairing"
  CHECK (
    CASE WHEN "paper_bundle"::text = 'Bundle'
      THEN "paper_sheets_per_bundle" IS NOT NULL AND "paper_sheets_per_bundle" > 0
      ELSE "paper_sheets_per_bundle" IS NULL
    END
  );
--> statement-breakpoint

ALTER TABLE "material_batch" ADD CONSTRAINT "material_batch_bundles_agree"
  CHECK (
    ("bundles" IS NULL AND "sheets_per_bundle" IS NULL)
    OR (
      "bundles" > 0 AND "sheets_per_bundle" > 0
      AND "qty_received" = "bundles" * "sheets_per_bundle"
    )
  );
--> statement-breakpoint

ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_bundles_agree"
  CHECK (
    ("bundles" IS NULL AND "sheets_per_bundle" IS NULL)
    OR (
      "bundles" > 0 AND "sheets_per_bundle" > 0
      AND "qty" = "bundles" * "sheets_per_bundle"
    )
  );
