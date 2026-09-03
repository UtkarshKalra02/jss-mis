-- ---------------------------------------------------------------------------
-- tooling.location becomes optional for a tool that is still on order (I11).
--
-- THE CHECK COMPARES status AS TEXT, DELIBERATELY. Writing it as
-- `status = 'Ordered'` casts the literal to the enum type, which Postgres
-- counts as USING the value migration 0022 had just added — and refuses inside
-- the same transaction:
--
--     ERROR: unsafe use of new value "Ordered" of enum type tool_status
--
-- That never fires when 0022 and 0023 are applied one at a time, which is how
-- they were written. It fires on every database that is two or more migrations
-- behind, because drizzle-kit applies all pending migrations in one
-- transaction. Production was exactly that case. See J16.
--
-- Every statement is idempotent, so a database that already applied the
-- earlier version of this file can re-run it without error.
-- ---------------------------------------------------------------------------

ALTER TABLE "tooling" DROP CONSTRAINT IF EXISTS "tooling_location_not_blank";--> statement-breakpoint
ALTER TABLE "tooling" ALTER COLUMN "location" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tooling" DROP CONSTRAINT IF EXISTS "tooling_location_present_unless_ordered";--> statement-breakpoint
ALTER TABLE "tooling" ADD CONSTRAINT "tooling_location_present_unless_ordered" CHECK (("tooling"."status"::text = 'Ordered' and ("tooling"."location" is null or length(trim("tooling"."location")) > 0))
          or ("tooling"."location" is not null and length(trim("tooling"."location")) > 0));