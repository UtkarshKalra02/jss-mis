CREATE TYPE "public"."supply_by" AS ENUM('Press', 'Party');--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_supply_by" "supply_by";--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "plate_supply_by" "supply_by";--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "plate_job_id" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "machine_detail" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "final_qty" integer;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "wastage_qty" integer;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "execution_remarks" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_final_qty_non_negative" CHECK ("job_card"."final_qty" is null or "job_card"."final_qty" >= 0);--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_wastage_qty_non_negative" CHECK ("job_card"."wastage_qty" is null or "job_card"."wastage_qty" >= 0);