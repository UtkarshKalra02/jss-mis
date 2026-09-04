CREATE TYPE "public"."paper_bundle" AS ENUM('Packet', 'Ream', 'Gross');--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_qty" integer;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_bundle" "paper_bundle";--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_parts" integer;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "exec_pantone" text;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_qty" integer;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_bundle" "paper_bundle";--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_parts" integer;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_paper_qty_positive" CHECK ("job_card"."paper_qty" is null or "job_card"."paper_qty" > 0);--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_paper_parts_positive" CHECK ("job_card"."paper_parts" is null or "job_card"."paper_parts" > 0);--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_paper_bundle_required" CHECK ("job_card"."paper_qty" is null or "job_card"."paper_bundle" is not null);--> statement-breakpoint
ALTER TABLE "press_run" ADD CONSTRAINT "press_run_paper_qty_positive" CHECK ("press_run"."paper_qty" is null or "press_run"."paper_qty" > 0);--> statement-breakpoint
ALTER TABLE "press_run" ADD CONSTRAINT "press_run_paper_parts_positive" CHECK ("press_run"."paper_parts" is null or "press_run"."paper_parts" > 0);--> statement-breakpoint
ALTER TABLE "press_run" ADD CONSTRAINT "press_run_paper_bundle_required" CHECK ("press_run"."paper_qty" is null or "press_run"."paper_bundle" is not null);