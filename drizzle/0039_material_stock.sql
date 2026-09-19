-- ===========================================================================
-- Material stock — the IMS (section O).
--
-- The first 123 statements are drizzle-kit's, from src/db/schema/materials.ts
-- and material-movements.ts: seven tables, two enums, the DATA_ENTRY role
-- value, and material_id on design and job_card. Everything after the marked
-- line is hand-written and must be kept if this file is ever regenerated:
--
--   1. v_material_batch_stock and v_material_stock — the ONLY definitions of
--      "remaining" and "closing stock". Nothing stores either (non-negotiable
--      2, applied to the store), because a stored count is right on the day it
--      is typed and wrong every day after.
--   2. material_issue_guard — an issue may not take a batch below zero. There
--      is no honest over-run in a store: paper that is not there cannot leave.
--      A count that has drifted is corrected with an adjustment first.
--   3. The paper GSM tolerance setting (O2), which the job card's picker reads.
--
-- ADDITIVE. Migrate first, then deploy (DEPLOYMENT.md §6). Note `ALTER TYPE
-- ... ADD VALUE`: Postgres will not let the new value be USED in the same
-- transaction that adds it, and nothing here does — the first DATA_ENTRY user
-- is created from the admin screen after the deploy.
-- ===========================================================================
CREATE TYPE "public"."material_adjustment_reason" AS ENUM('Count correction', 'Damage', 'Return to vendor', 'Other');--> statement-breakpoint
CREATE TYPE "public"."material_unit" AS ENUM('Sheet', 'Kg', 'Ltr', 'Pc', 'Pkt');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'DATA_ENTRY';--> statement-breakpoint
CREATE TABLE "grn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"grn_no" text NOT NULL,
	"received_date" date NOT NULL,
	"vendor" text NOT NULL,
	"invoice_no" text,
	"invoice_url" text,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"size" text,
	"gsm" integer,
	"colour" text,
	"finish" text,
	"unit" "material_unit" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"average_daily_consumption" numeric(12, 2),
	"lead_time_days" integer,
	"min_order_qty" numeric(12, 2),
	"max_level" numeric(12, 2),
	"in_transit_qty" numeric(12, 2),
	"remarks" text,
	CONSTRAINT "material_gsm_positive" CHECK ("material"."gsm" is null or "material"."gsm" > 0),
	CONSTRAINT "material_lead_time_non_negative" CHECK ("material"."lead_time_days" is null or "material"."lead_time_days" >= 0),
	CONSTRAINT "material_in_transit_non_negative" CHECK ("material"."in_transit_qty" is null or "material"."in_transit_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"batch_no" text NOT NULL,
	"grn_id" uuid,
	"material_id" uuid NOT NULL,
	"received_date" date NOT NULL,
	"qty_received" numeric(12, 2) NOT NULL,
	"remarks" text,
	CONSTRAINT "material_batch_qty_positive" CHECK ("material_batch"."qty_received" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_category" (
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
CREATE TABLE "material_type" (
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
CREATE TABLE "material_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"adjustment_no" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"adjusted_on" date NOT NULL,
	"qty" numeric(12, 2) NOT NULL,
	"reason" "material_adjustment_reason" NOT NULL,
	"remarks" text,
	CONSTRAINT "material_adjustment_qty_nonzero" CHECK ("material_adjustment"."qty" <> 0)
);
--> statement-breakpoint
CREATE TABLE "material_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"issue_no" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"qty" numeric(12, 2) NOT NULL,
	"department" text,
	"job_card_id" uuid,
	"remarks" text,
	CONSTRAINT "material_issue_qty_positive" CHECK ("material_issue"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "job_card" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "grn" ADD CONSTRAINT "grn_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn" ADD CONSTRAINT "grn_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_category_id_material_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."material_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_type_id_material_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."material_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_batch" ADD CONSTRAINT "material_batch_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_batch" ADD CONSTRAINT "material_batch_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_batch" ADD CONSTRAINT "material_batch_grn_id_grn_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grn"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_batch" ADD CONSTRAINT "material_batch_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_category" ADD CONSTRAINT "material_category_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_category" ADD CONSTRAINT "material_category_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_type" ADD CONSTRAINT "material_type_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_type" ADD CONSTRAINT "material_type_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_adjustment" ADD CONSTRAINT "material_adjustment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_adjustment" ADD CONSTRAINT "material_adjustment_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_adjustment" ADD CONSTRAINT "material_adjustment_batch_id_material_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_batch_id_material_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_job_card_id_job_card_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grn_no_key" ON "grn" USING btree ("grn_no") WHERE "grn"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "grn_received_date_idx" ON "grn" USING btree ("received_date");--> statement-breakpoint
CREATE UNIQUE INDEX "material_sku_key" ON "material" USING btree ("sku") WHERE "material"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "material_category_idx" ON "material" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "material_type_idx" ON "material" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "material_gsm_idx" ON "material" USING btree ("gsm");--> statement-breakpoint
CREATE UNIQUE INDEX "material_batch_no_key" ON "material_batch" USING btree ("batch_no") WHERE "material_batch"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "material_batch_material_idx" ON "material_batch" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_batch_grn_idx" ON "material_batch" USING btree ("grn_id");--> statement-breakpoint
CREATE INDEX "material_batch_received_idx" ON "material_batch" USING btree ("received_date");--> statement-breakpoint
CREATE UNIQUE INDEX "material_category_code_key" ON "material_category" USING btree ("code") WHERE "material_category"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "material_type_code_key" ON "material_type" USING btree ("code") WHERE "material_type"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "material_adjustment_no_key" ON "material_adjustment" USING btree ("adjustment_no") WHERE "material_adjustment"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "material_adjustment_batch_idx" ON "material_adjustment" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "material_adjustment_date_idx" ON "material_adjustment" USING btree ("adjusted_on");--> statement-breakpoint
CREATE UNIQUE INDEX "material_issue_no_key" ON "material_issue" USING btree ("issue_no") WHERE "material_issue"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "material_issue_batch_idx" ON "material_issue" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "material_issue_job_card_idx" ON "material_issue" USING btree ("job_card_id");--> statement-breakpoint
CREATE INDEX "material_issue_date_idx" ON "material_issue" USING btree ("issued_on");--> statement-breakpoint
ALTER TABLE "design" ADD CONSTRAINT "design_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_card" ADD CONSTRAINT "job_card_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_material_idx" ON "design" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "job_card_material_idx" ON "job_card" USING btree ("material_id");

-- ===========================================================================
-- HAND-WRITTEN FROM HERE. Do not regenerate over it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. What each batch has left, and what each material has in total
--
-- Soft-deleted issues and adjustments do not count — removing a mistaken
-- issue puts the paper back, which is the point of removing it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_material_batch_stock AS
WITH issued AS (
  SELECT batch_id, SUM(qty) AS qty
  FROM material_issue
  WHERE deleted_at IS NULL
  GROUP BY batch_id
),
adjusted AS (
  SELECT batch_id, SUM(qty) AS qty
  FROM material_adjustment
  WHERE deleted_at IS NULL
  GROUP BY batch_id
)
SELECT
  b.id                                   AS batch_id,
  b.batch_no,
  b.material_id,
  b.grn_id,
  b.received_date,
  b.qty_received,
  COALESCE(i.qty, 0)                     AS qty_issued,
  COALESCE(a.qty, 0)                     AS qty_adjusted,
  -- THE definition of remaining. Received, less issued, plus signed
  -- adjustments. Computed here and stored nowhere.
  b.qty_received - COALESCE(i.qty, 0) + COALESCE(a.qty, 0) AS qty_remaining
FROM material_batch b
LEFT JOIN issued i   ON i.batch_id = b.id
LEFT JOIN adjusted a ON a.batch_id = b.id
WHERE b.deleted_at IS NULL;
--> statement-breakpoint

CREATE OR REPLACE VIEW v_material_stock AS
WITH stock AS (
  SELECT
    material_id,
    SUM(qty_remaining)                                        AS closing_stock,
    COUNT(*) FILTER (WHERE qty_remaining > 0)::integer        AS open_batches,
    MIN(received_date) FILTER (WHERE qty_remaining > 0)       AS oldest_open_batch
  FROM v_material_batch_stock
  GROUP BY material_id
)
SELECT
  m.id                                    AS material_id,
  m.sku,
  m.name,
  m.category_id,
  mc.name                                 AS category_name,
  m.type_id,
  mt.name                                 AS type_name,
  m.size,
  m.gsm,
  m.colour,
  m.finish,
  m.unit,
  m.is_active,
  m.average_daily_consumption,
  m.lead_time_days,
  m.min_order_qty,
  m.max_level,
  COALESCE(m.in_transit_qty, 0)           AS in_transit_qty,

  COALESCE(s.closing_stock, 0)            AS closing_stock,
  COALESCE(s.open_batches, 0)             AS open_batches,
  s.oldest_open_batch,

  -- Reorder level is 80% of max, the sheet's own rule. Null when there is no
  -- max: a material nobody has set a level for cannot be "below" it.
  CASE WHEN m.max_level IS NOT NULL THEN ROUND(m.max_level * 0.8, 2) END AS reorder_level,

  -- Days of stock at the typed consumption rate, in-transit included, the way
  -- the sheet computed it. Null when consumption is unknown or zero — an
  -- item nobody consumes does not run out, and "infinite" is not a number a
  -- grid should show.
  CASE
    WHEN m.average_daily_consumption IS NULL OR m.average_daily_consumption <= 0 THEN NULL
    ELSE ROUND(
      (COALESCE(s.closing_stock, 0) + COALESCE(m.in_transit_qty, 0))
        / m.average_daily_consumption, 1)
  END                                     AS days_remaining,

  -- Below the reorder level, or will run out inside the lead time. FALSE
  -- rather than NULL when it cannot be judged, for the reason is_overdue is.
  (
    m.is_active
    AND (
      (m.max_level IS NOT NULL
        AND COALESCE(s.closing_stock, 0) + COALESCE(m.in_transit_qty, 0) < m.max_level * 0.8)
      OR (m.average_daily_consumption IS NOT NULL AND m.average_daily_consumption > 0
        AND m.lead_time_days IS NOT NULL
        AND (COALESCE(s.closing_stock, 0) + COALESCE(m.in_transit_qty, 0))
              / m.average_daily_consumption <= m.lead_time_days)
    )
  )                                       AS needs_reorder
FROM material m
JOIN material_category mc ON mc.id = m.category_id
JOIN material_type mt     ON mt.id = m.type_id
LEFT JOIN stock s         ON s.material_id = m.id
WHERE m.deleted_at IS NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. An issue cannot take a batch below zero
--
-- Checked on insert and on any update that changes the batch or the quantity,
-- and on restore from soft delete. The batch row is locked first so two
-- issues typed at once cannot both pass against the same last ream.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION material_issue_guard() RETURNS trigger AS $$
DECLARE
  v_remaining numeric;
  v_batch_no  text;
  v_unit      text;
BEGIN
  PERFORM 1 FROM material_batch WHERE id = NEW.batch_id FOR UPDATE;

  SELECT s.qty_remaining, s.batch_no, m.unit::text
    INTO v_remaining, v_batch_no, v_unit
  FROM v_material_batch_stock s
  JOIN material m ON m.id = s.material_id
  WHERE s.batch_id = NEW.batch_id;

  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'Issue references a batch that does not exist or was removed.';
  END IF;

  -- On update the old row is still counted in v_remaining; add it back.
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND OLD.batch_id = NEW.batch_id THEN
    v_remaining := v_remaining + OLD.qty;
  END IF;

  IF NEW.qty > v_remaining THEN
    RAISE EXCEPTION
      'Batch % has only % % left; cannot issue %. If the count is wrong, record an adjustment first.',
      v_batch_no, v_remaining, v_unit, NEW.qty;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS material_issue_guard_trg ON material_issue;
--> statement-breakpoint

CREATE TRIGGER material_issue_guard_trg
  BEFORE INSERT OR UPDATE OF qty, batch_id, deleted_at ON material_issue
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION material_issue_guard();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. The GSM tolerance the job card's paper picker works to (O2)
-- ---------------------------------------------------------------------------

INSERT INTO app_setting (key, value, description)
VALUES (
  'paper_gsm_tolerance_pct',
  '5',
  'When a job card asks for a paper of a given GSM, the picker also offers papers of the same type and size within this percentage — nearest first, with stock on hand. The planner still chooses; this only decides what is shown.'
)
ON CONFLICT (key) DO NOTHING;
