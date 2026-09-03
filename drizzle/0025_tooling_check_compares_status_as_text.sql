-- ---------------------------------------------------------------------------
-- Re-states the constraint 0023 now writes, so the schema SNAPSHOT matches.
--
-- 0023 was edited in place to compare `status` as text rather than as an enum
-- literal (J16), which is what lets it run in the same transaction as 0022.
-- Its meta snapshot still described the old form, so every `db:generate` would
-- have emitted this diff forever. This file settles it.
--
-- On a database that already ran the corrected 0023 this drops and recreates
-- an identical constraint — a no-op with a name.
-- ---------------------------------------------------------------------------

ALTER TABLE "tooling" DROP CONSTRAINT IF EXISTS "tooling_location_present_unless_ordered";--> statement-breakpoint
ALTER TABLE "tooling" ADD CONSTRAINT "tooling_location_present_unless_ordered" CHECK (("tooling"."status"::text = 'Ordered' and ("tooling"."location" is null or length(trim("tooling"."location")) > 0))
          or ("tooling"."location" is not null and length(trim("tooling"."location")) > 0));