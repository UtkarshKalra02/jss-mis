-- ---------------------------------------------------------------------------
-- The day's plan, one line per item per day. Decision M1.
--
-- The 6pm meeting plans PO ITEMS, not job cards — a card is often raised on
-- the morning the job runs. An entry is an item, a day, and what happens to
-- it that day: a station (Production, stage_code required) or the gate
-- (Dispatch, no stage, quantity defaulting to pending). `sequence` is the
-- order within the day; an urgent job is inserted and the rest shift.
--
-- The plan is a human decision with no other source, so storing it leaves
-- non-negotiables 1 and 2 untouched: the item's stage and pending quantity
-- are still read from v_po_item_status, never from here.
--
-- Additive: migrate first, then deploy.
-- ---------------------------------------------------------------------------
CREATE TYPE "public"."plan_kind" AS ENUM('Production', 'Dispatch');--> statement-breakpoint
CREATE TABLE "plan_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"plan_date" date NOT NULL,
	"po_item_id" uuid NOT NULL,
	"kind" "plan_kind" NOT NULL,
	"stage_code" text,
	"machine_id" uuid,
	"sequence" integer DEFAULT 0 NOT NULL,
	"planned_qty" integer,
	"notes" text,
	CONSTRAINT "plan_entry_kind_stage" CHECK (("plan_entry"."kind" = 'Production' and "plan_entry"."stage_code" is not null)
          or ("plan_entry"."kind" = 'Dispatch' and "plan_entry"."stage_code" is null and "plan_entry"."machine_id" is null)),
	CONSTRAINT "plan_entry_planned_qty_positive" CHECK ("plan_entry"."planned_qty" is null or "plan_entry"."planned_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "plan_entry" ADD CONSTRAINT "plan_entry_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entry" ADD CONSTRAINT "plan_entry_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entry" ADD CONSTRAINT "plan_entry_po_item_id_po_item_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."po_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entry" ADD CONSTRAINT "plan_entry_stage_code_stage_code_fk" FOREIGN KEY ("stage_code") REFERENCES "public"."stage"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entry" ADD CONSTRAINT "plan_entry_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_entry_key" ON "plan_entry" USING btree ("plan_date","kind","po_item_id",coalesce("stage_code", '')) WHERE "plan_entry"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "plan_entry_day_idx" ON "plan_entry" USING btree ("plan_date","kind","sequence");--> statement-breakpoint
CREATE INDEX "plan_entry_po_item_idx" ON "plan_entry" USING btree ("po_item_id");