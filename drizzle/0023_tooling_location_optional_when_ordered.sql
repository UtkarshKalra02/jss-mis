ALTER TABLE "tooling" DROP CONSTRAINT "tooling_location_not_blank";--> statement-breakpoint
ALTER TABLE "tooling" ALTER COLUMN "location" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tooling" ADD CONSTRAINT "tooling_location_present_unless_ordered" CHECK (("tooling"."status" = 'Ordered' and ("tooling"."location" is null or length(trim("tooling"."location")) > 0))
          or ("tooling"."location" is not null and length(trim("tooling"."location")) > 0));