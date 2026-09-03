ALTER TABLE "press_run" ADD COLUMN "machine_id" uuid;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_size" text;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_gsm" text;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_finish" text;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "sheets_per_ream" integer;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_remarks" text;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "plate_job_id" text;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "paper_supply_by" "supply_by";--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "plate_supply_by" "supply_by";--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "final_qty" integer;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "wastage_qty" integer;--> statement-breakpoint
ALTER TABLE "press_run" ADD COLUMN "execution_remarks" text;--> statement-breakpoint
ALTER TABLE "press_run" ADD CONSTRAINT "press_run_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_run" ADD CONSTRAINT "press_run_final_qty_non_negative" CHECK ("press_run"."final_qty" is null or "press_run"."final_qty" >= 0);--> statement-breakpoint
ALTER TABLE "press_run" ADD CONSTRAINT "press_run_wastage_qty_non_negative" CHECK ("press_run"."wastage_qty" is null or "press_run"."wastage_qty" >= 0);--> statement-breakpoint
ALTER TABLE "press_run" ADD CONSTRAINT "press_run_sheets_per_ream_positive" CHECK ("press_run"."sheets_per_ream" is null or "press_run"."sheets_per_ream" > 0);