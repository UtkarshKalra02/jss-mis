CREATE TYPE "public"."fabrication_scope" AS ENUM('Design', 'Run', 'None');--> statement-breakpoint
CREATE TABLE "design_fabrication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"design_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"value_id" uuid,
	"other_text" text,
	CONSTRAINT "design_fabrication_other_text_blank_or_set" CHECK ("design_fabrication"."other_text" is null or length(trim("design_fabrication"."other_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "fabrication_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"value_scope" "fabrication_scope" NOT NULL,
	"allows_free_text" boolean DEFAULT false NOT NULL,
	"sequence" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fabrication_option_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"option_id" uuid NOT NULL,
	"value" text NOT NULL,
	"sequence" integer NOT NULL,
	CONSTRAINT "fabrication_option_value_key" UNIQUE("option_id","value"),
	CONSTRAINT "fabrication_option_value_id_option_key" UNIQUE("id","option_id")
);
--> statement-breakpoint
CREATE TABLE "job_card_fabrication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"job_card_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"value_id" uuid,
	"other_text" text
);
--> statement-breakpoint
ALTER TABLE "design_fabrication" ADD CONSTRAINT "design_fabrication_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_fabrication" ADD CONSTRAINT "design_fabrication_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_fabrication" ADD CONSTRAINT "design_fabrication_design_id_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."design"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_fabrication" ADD CONSTRAINT "design_fabrication_option_id_fabrication_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."fabrication_option"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_fabrication" ADD CONSTRAINT "design_fabrication_value_fk" FOREIGN KEY ("value_id","option_id") REFERENCES "public"."fabrication_option_value"("id","option_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_option" ADD CONSTRAINT "fabrication_option_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_option" ADD CONSTRAINT "fabrication_option_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_option_value" ADD CONSTRAINT "fabrication_option_value_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_option_value" ADD CONSTRAINT "fabrication_option_value_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabrication_option_value" ADD CONSTRAINT "fabrication_option_value_option_id_fabrication_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."fabrication_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_fabrication" ADD CONSTRAINT "job_card_fabrication_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_fabrication" ADD CONSTRAINT "job_card_fabrication_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_fabrication" ADD CONSTRAINT "job_card_fabrication_job_card_id_job_card_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_fabrication" ADD CONSTRAINT "job_card_fabrication_option_id_fabrication_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."fabrication_option"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card_fabrication" ADD CONSTRAINT "job_card_fabrication_value_fk" FOREIGN KEY ("value_id","option_id") REFERENCES "public"."fabrication_option_value"("id","option_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_fabrication_key" ON "design_fabrication" USING btree ("design_id","option_id") WHERE "design_fabrication"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "design_fabrication_option_idx" ON "design_fabrication" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fabrication_option_code_key" ON "fabrication_option" USING btree ("code") WHERE "fabrication_option"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "fabrication_option_sequence_idx" ON "fabrication_option" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "fabrication_option_value_option_idx" ON "fabrication_option_value" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_card_fabrication_key" ON "job_card_fabrication" USING btree ("job_card_id","option_id") WHERE "job_card_fabrication"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "job_card_fabrication_option_idx" ON "job_card_fabrication" USING btree ("option_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- SEED: the fabrication vocabulary, transcribed from the paper job card.
--
-- These are the factory's own words, in the paper form's own order — left
-- column first, then the right. Labels are VERBATIM: "N. Lamination" is kept
-- exactly as printed rather than expanded to "Normal Lamination", which is the
-- likely reading but is unconfirmed, and a guess printed on a floor document
-- reads as a fact (A2).
--
-- BINDING (Perfect / Side Stitch / Centre Stitch / Hard Bound) is on the paper
-- card and is deliberately NOT seeded here — out of scope by decision.
--
-- Seeded as DATA, not as an enum, so a new finishing process is a row rather
-- than a migration and a deploy. Same reasoning that keeps stages in a table
-- (C3).
--
-- value_scope:
--   Design — the value belongs to the design, reused every order
--   Run    — the value belongs to the job card; the design does not change
--            between orders but the tooling does
--   None   — a plain tick, no question attached
-- ---------------------------------------------------------------------------

INSERT INTO fabrication_option (code, label, value_scope, allows_free_text, sequence) VALUES
  ('N_LAMINATION',       'N. Lamination',        'Design', false,  10),
  ('THERMAL',            'Thermal',              'Design', false,  20),
  ('SILVER_LAMINATION',  'Silver Lamination',    'Design', false,  30),
  ('UV',                 'UV',                   'Design', false,  40),
  -- New or old refers to the hybrid UV plate, which is a fact about THIS run.
  ('HYBRID_UV',          'Hybrid UV',            'Run',    false,  50),
  ('VARNISH',            'Varnish',              'Design', false,  60),
  -- 'Other' is the one option that needs somewhere to say what it was.
  ('FOILING',            'Foiling',              'Design', true,   70),
  ('EMBOSSING',          'Embossing',            'Run',    false,  80),
  ('DIE',                'Die',                  'Run',    false,  90),
  ('BOX_PASTING_PLASMA', 'Box Pasting — Plasma', 'Design', false, 100),
  ('BOX_PASTING_MANUAL', 'Box Pasting — Manual', 'None',   false, 110),
  ('LOCK_PASTING',       'Lock Pasting',         'None',   false, 120),
  ('SIDE_PASTING',       'Side Pasting',         'None',   false, 130);
--> statement-breakpoint

INSERT INTO fabrication_option_value (option_id, value, sequence)
SELECT o.id, v.value, v.seq
FROM fabrication_option o
JOIN (VALUES
  ('N_LAMINATION',      'Matt',   10),
  ('N_LAMINATION',      'Gloss',  20),

  ('THERMAL',           'Matt',   10),
  ('THERMAL',           'Gloss',  20),

  -- Wet vs thermal is the APPLICATION METHOD, and the paper card attaches it
  -- to silver lamination only. It is not a general lamination axis.
  ('SILVER_LAMINATION', 'Wet',    10),
  ('SILVER_LAMINATION', 'Thermal',20),

  ('UV',                'Full',   10),
  ('UV',                'Spot',   20),

  ('HYBRID_UV',         'New',    10),
  ('HYBRID_UV',         'Old',    20),

  ('VARNISH',           'Gloss',  10),
  ('VARNISH',           'Matt',   20),
  ('VARNISH',           'Silk',   30),

  ('FOILING',           'Gold',   10),
  ('FOILING',           'Silver', 20),
  ('FOILING',           'Other',  30),

  ('EMBOSSING',         'New',    10),
  ('EMBOSSING',         'Old',    20),

  -- The card prints this one "Old / New" rather than "New / Old". Kept in the
  -- card's order, because the sheet and the screen should read the same way.
  ('DIE',               'Old',    10),
  ('DIE',               'New',    20),

  ('BOX_PASTING_PLASMA','Y',      10),
  ('BOX_PASTING_PLASMA','N',      20)
) AS v(code, value, seq) ON v.code = o.code;
