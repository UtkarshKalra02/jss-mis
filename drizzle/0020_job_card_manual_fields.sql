CREATE TABLE "machine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sheet_size" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "machine_id" uuid;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "checklist_paper" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "checklist_plates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "checklist_colour" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_size" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_gsm" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_finish" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "sheets_per_ream" integer;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "paper_remarks" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "exec_no_of_colours" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "exec_size" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "exec_planning" text;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "fabrication_remarks" text;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_code_key" ON "machine" USING btree ("code") WHERE "machine"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "machine_sequence_idx" ON "machine" USING btree ("sequence");--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_sheets_per_ream_positive" CHECK ("job_card"."sheets_per_ream" is null or "job_card"."sheets_per_ream" > 0);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- SEED: the presses, from the paper job card's Machine Detail tick list.
--
-- Only the two the card prints. If there are more, they are a row each and no
-- code changes — which is the point of this being a table rather than an enum
-- (C3). Nothing here is guessed: a press nobody has named is a press that does
-- not appear (A2).
-- ---------------------------------------------------------------------------

INSERT INTO machine (code, name, sheet_size, sequence) VALUES
  ('SM72-6COL', 'SM-72 — 6 Colour', '20" x 28.5"', 10),
  ('SM72-2COL', 'SM-72 — 2 Colour', '20" x 28.5"', 20);
