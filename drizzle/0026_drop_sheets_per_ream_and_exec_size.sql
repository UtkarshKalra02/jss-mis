ALTER TABLE "job_card" DROP CONSTRAINT "job_card_sheets_per_ream_positive";--> statement-breakpoint
ALTER TABLE "press_run" DROP CONSTRAINT "press_run_sheets_per_ream_positive";--> statement-breakpoint
ALTER TABLE "job_card" DROP COLUMN "sheets_per_ream";--> statement-breakpoint
ALTER TABLE "job_card" DROP COLUMN "exec_size";--> statement-breakpoint
ALTER TABLE "job_card" DROP COLUMN "exec_planning";--> statement-breakpoint
ALTER TABLE "press_run" DROP COLUMN "sheets_per_ream";