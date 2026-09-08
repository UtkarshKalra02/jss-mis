-- ---------------------------------------------------------------------------
-- The enquiry register — bringing the Phase 1 skeleton up to the build spec.
--
-- `enquiry` and `quotation` have existed since 0000, read by no screen. This
-- reshapes `enquiry` for the register about to be built on it.
--
-- WHY THIS IS TWO MIGRATIONS. 0034 drops `description` and `expected_qty`,
-- whose replacements (`item_description`, `qty`) are added here. Logically it
-- is one rename, but drizzle-kit only offers rename detection through an
-- interactive prompt, and a migration whose SQL depends on somebody answering
-- a question correctly is worse than two files. Splitting it into an additive
-- pass and a subtractive one keeps both generated, so the snapshots in
-- drizzle/meta stay honest — a hand-written migration leaves them describing a
-- schema that no longer exists, and the NEXT person to run `generate` gets a
-- migration trying to recreate this whole table.
--
-- THAT SPLIT IS ONLY SAFE BECAUSE THE TABLE IS EMPTY. Both databases were
-- checked before this was written: `enquiry` holds 0 rows in development and 0
-- in production. Add + drop moves no data here. On a populated table this
-- would need an UPDATE between the two, and that is the reason this note
-- exists rather than a comment saying "renamed".
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Why an enquiry was lost, as a fixed list rather than free text.
--
-- The point of the field is to be countable: "we lose on price" is only
-- knowable if PRICE is the same value every time, which prose never is.
-- 'Unknown' is offered deliberately — the alternative to an honest unknown is
-- somebody picking a plausible reason to get past the form, which poisons the
-- count the field exists to feed.
-- ---------------------------------------------------------------------------
CREATE TYPE "public"."enquiry_lost_reason" AS ENUM('Price', 'Lead Time', 'Capability', 'No Response', 'Client Deferred', 'Lost To Known Competitor', 'Unknown');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Dropped is not Lost.
--
-- Lost means a competitor won it, and it carries a required reason. Dropped
-- means the enquiry stopped being one without anybody winning it — the client
-- shelved the product, or it was never real. Counting those as losses would
-- understate the win rate against work actually competed for.
--
-- IF NOT EXISTS because the development database already carries this label
-- from an earlier attempt at this migration. Postgres allows ADD VALUE inside
-- a transaction on PG12+; what it forbids is USING the new label before the
-- transaction commits, which is why the view at the bottom compares it as text.
-- ---------------------------------------------------------------------------
ALTER TYPE "public"."enquiry_status" ADD VALUE IF NOT EXISTS 'Dropped';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- enquiry_source — a TABLE, not an enum.
--
-- The build spec asked for "enum, ADMIN-editable lookup". Those cannot both be
-- true: changing a Postgres enum is a migration and a deploy, so an admin
-- screen over one would be a lie. This follows `stage`, the pattern already
-- established for a list the factory owns rather than the code, and which
-- non-negotiable 5 exists to protect. A new source is a row, not a release.
--
-- Deactivated rather than deleted, for the same reason a stage is: enquiries
-- already recorded against a source must keep reading correctly after it stops
-- being offered on the form.
-- ---------------------------------------------------------------------------
CREATE TABLE "enquiry_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiry_source" ADD CONSTRAINT "enquiry_source_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_source" ADD CONSTRAINT "enquiry_source_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enquiry_source_code_key" ON "enquiry_source" USING btree ("code") WHERE "enquiry_source"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "enquiry_source_sequence_idx" ON "enquiry_source" USING btree ("sequence");--> statement-breakpoint

-- The six the spec named. Everything after this is Utkarsh's to add from the
-- admin screen; the codes are what the application matches on, the names are
-- what gets edited.
INSERT INTO "enquiry_source" ("code", "name", "sequence") VALUES
  ('REFERRAL',        'Referral',        10),
  ('EXISTING_CLIENT', 'Existing client', 20),
  ('WALK_IN',         'Walk-in',         30),
  ('PHONE',           'Phone',           40),
  ('INDIAMART',       'IndiaMART',       50),
  ('OTHER',           'Other',           60);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- lost_reason becomes the enum.
--
-- The old check tested for a non-blank string; an enum cannot hold one, so it
-- is dropped and rewritten rather than kept. THE RULE IS UNCHANGED and still
-- lives in the database rather than only in the form (non-negotiable 4): a
-- bulk update or a script cannot produce a Lost enquiry with no explanation.
-- ---------------------------------------------------------------------------
ALTER TABLE "enquiry" DROP CONSTRAINT "enquiry_lost_reason_required";--> statement-breakpoint
ALTER TABLE "enquiry" ALTER COLUMN "lost_reason" SET DATA TYPE "public"."enquiry_lost_reason" USING "lost_reason"::"public"."enquiry_lost_reason";--> statement-breakpoint

-- Today in IST, not UTC. An enquiry taken at 9pm in Delhi is 15:30 UTC the
-- same day, and current_date on a UTC server would file it under yesterday —
-- which would also hand it the wrong financial year every 31 March.
ALTER TABLE "enquiry" ALTER COLUMN "enquiry_date" SET DEFAULT today_ist();--> statement-breakpoint

-- An enquiry nobody owns is nobody's to chase, which is the failure this
-- register exists to fix.
ALTER TABLE "enquiry" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "enquiry" ADD COLUMN "source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiry" ADD COLUMN "referred_by" text;--> statement-breakpoint
ALTER TABLE "enquiry" ADD COLUMN "item_description" text NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiry" ADD COLUMN "qty" integer;--> statement-breakpoint

-- THE CLIENT'S STATED ASK, and nothing more. It must never be copied into
-- po_item.committed_date. What a client asks for and what this factory commits
-- to are different numbers, and OTD is measured against the second — promoting
-- an ask into a commitment would make the factory late against a date nobody
-- here ever agreed to.
ALTER TABLE "enquiry" ADD COLUMN "client_required_date" date;--> statement-breakpoint

ALTER TABLE "enquiry" ADD COLUMN "lost_notes" text;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_source_id_enquiry_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."enquiry_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiry_source_idx" ON "enquiry" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "enquiry_owner_idx" ON "enquiry" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_lost_reason_required" CHECK ("enquiry"."status" <> 'Lost' or "enquiry"."lost_reason" is not null);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- v_enquiry_funnel learns about Dropped.
--
-- ONE COLUMN ADDED, NO EXISTING ONE CHANGED. dropped_count joins won, lost and
-- open; every other count means exactly what it meant before.
--
-- Note what this does NOT claim to fix. The status counts have never summed to
-- enquiry_count and still do not: an enquiry sitting at 'Quoted' appears in
-- none of them, because quoted_count deliberately measures something else —
-- enquiries with a QUOTATION ROW attached, not ones somebody set to 'Quoted'.
-- Statuses drift; rows do not. Making the four statuses add up would mean
-- either folding 'Quoted' into open_count or adding a fifth count, and both
-- are decisions about a Phase 6 report that nothing reads yet. Adding
-- dropped_count is not: without it the new status would be invisible here
-- rather than merely uncounted, which is the worse of the two.
--
-- quote_to_win_pct is unchanged and still divides by what was quoted. A
-- dropped enquiry is in that denominator only if it was quoted before being
-- dropped, which is correct: quoting work that then evaporated is a real cost.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_enquiry_funnel;--> statement-breakpoint

CREATE VIEW v_enquiry_funnel AS
WITH quoted AS (
  SELECT DISTINCT enquiry_id
  FROM quotation
  WHERE deleted_at IS NULL
)
SELECT
  date_trunc('month', e.enquiry_date)::date            AS month,
  e.client_id,
  c.code                                               AS client_code,
  c.name                                               AS client_name,
  COUNT(*)::integer                                    AS enquiry_count,
  COUNT(*) FILTER (WHERE q.enquiry_id IS NOT NULL)::integer AS quoted_count,
  COUNT(*) FILTER (WHERE e.status = 'Won')::integer    AS won_count,
  COUNT(*) FILTER (WHERE e.status = 'Lost')::integer   AS lost_count,
  -- COMPARED AS TEXT, and only this one. 'Dropped' is added by this same
  -- migration, and Postgres refuses to let a transaction USE an enum value it
  -- has not committed yet ("unsafe use of new value"). Casting to text
  -- sidesteps that without splitting the migration further. Same fix as 0025,
  -- for the same reason. The others compare as enum because their labels have
  -- existed since 0000.
  COUNT(*) FILTER (WHERE e.status::text = 'Dropped')::integer AS dropped_count,
  COUNT(*) FILTER (WHERE e.status = 'Open')::integer   AS open_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE e.status = 'Won')
          / NULLIF(COUNT(*) FILTER (WHERE q.enquiry_id IS NOT NULL), 0), 1
  )                                                    AS quote_to_win_pct
FROM enquiry e
JOIN client c ON c.id = e.client_id
LEFT JOIN quoted q ON q.enquiry_id = e.id
WHERE e.deleted_at IS NULL
GROUP BY 1, 2, 3, 4;
