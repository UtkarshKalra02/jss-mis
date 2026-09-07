CREATE TABLE "job_card_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"job_card_id" uuid NOT NULL,
	"po_item_id" uuid NOT NULL,
	"planned_qty" integer,
	CONSTRAINT "job_card_item_planned_qty_positive" CHECK ("job_card_item"."planned_qty" is null or "job_card_item"."planned_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "job_card" DROP CONSTRAINT "job_card_planned_qty_positive";--> statement-breakpoint
ALTER TABLE "job_card" DROP CONSTRAINT "job_card_po_item_id_po_item_id_fk";
--> statement-breakpoint
DROP INDEX "job_card_po_item_idx";--> statement-breakpoint
ALTER TABLE "job_card_item" ADD CONSTRAINT "job_card_item_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_item" ADD CONSTRAINT "job_card_item_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_item" ADD CONSTRAINT "job_card_item_job_card_id_job_card_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_item" ADD CONSTRAINT "job_card_item_po_item_id_po_item_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."po_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_card_item_key" ON "job_card_item" USING btree ("job_card_id","po_item_id") WHERE "job_card_item"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "job_card_item_po_item_idx" ON "job_card_item" USING btree ("po_item_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- BACKFILL, BEFORE THE DROPS. Every existing card covers exactly the one item
-- it already pointed at, carrying its quantity across. drizzle-kit generates
-- the create and the drops and nothing in between, so this is added by hand —
-- without it the columns go and every card in the system forgets which job it
-- is for.
--
-- Soft-deleted cards are included: they keep their history (non-negotiable 7),
-- and a removed card that forgot its item would be unreadable in the audit log.
-- ---------------------------------------------------------------------------
INSERT INTO "job_card_item" ("job_card_id", "po_item_id", "planned_qty", "created_by", "updated_by")
SELECT "id", "po_item_id", "planned_qty", "created_by", "updated_by"
  FROM "job_card"
 WHERE NOT EXISTS (
   SELECT 1 FROM "job_card_item" jci WHERE jci."job_card_id" = "job_card"."id"
 );
--> statement-breakpoint
ALTER TABLE "job_card" DROP COLUMN "po_item_id";--> statement-breakpoint
ALTER TABLE "job_card" DROP COLUMN "planned_qty";