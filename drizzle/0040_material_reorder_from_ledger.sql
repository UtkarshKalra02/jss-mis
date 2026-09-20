-- ===========================================================================
-- The store, rebuilt to the sheet's own rules (section P).
--
-- The first twelve statements are drizzle-kit's: the reorder method and note
-- enums, the typed reorder figures the sheet's "Calc Method" needs, a photo
-- link, and a job reference on batches and issues. Everything after the
-- marked line is hand-written and must survive a regeneration:
--
--   1. v_material_stock, REPLACED so that everything the sheet computed is
--      computed here — average daily consumption from actual issues over a
--      window, max level from ADC, days remaining, order-by date, suggested
--      quantity, the "due for issue" check, and the sheet's five statuses.
--      Two typed columns (average_daily_consumption, max_level) stop being
--      read; they are dropped in a later, deploy-first migration.
--   2. The consumption window setting the view reads.
--
-- ADDITIVE. Migrate first, then deploy. Postgres allows CREATE OR REPLACE
-- VIEW only when existing columns keep their names and types and new ones
-- are appended, which this respects: every column of 0039's view is still
-- here in the same order, and the new ones follow.
-- ===========================================================================
CREATE TYPE "public"."material_reorder_method" AS ENUM('On demand', 'Consumption', 'Interval');--> statement-breakpoint
CREATE TYPE "public"."material_reorder_note" AS ENUM('Ordered', 'Hold', 'Ignore');--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "reorder_method" "material_reorder_method" DEFAULT 'On demand' NOT NULL;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "safety_factor" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "issue_interval_days" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "reorder_note" "material_reorder_note";--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "reorder_note_on" date;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "material_batch" ADD COLUMN "job_ref" text;--> statement-breakpoint
ALTER TABLE "material_issue" ADD COLUMN "job_ref" text;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_issue_interval_positive" CHECK ("material"."issue_interval_days" is null or "material"."issue_interval_days" > 0);--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_safety_factor_non_negative" CHECK ("material"."safety_factor" is null or "material"."safety_factor" >= 0);

-- ===========================================================================
-- HAND-WRITTEN FROM HERE. Do not regenerate over it.
-- ===========================================================================

INSERT INTO app_setting (key, value, description)
VALUES (
  'material_adc_window_days',
  '90',
  'Average daily consumption of a material is total quantity issued over this many days, divided by the days. The sheet divided all-time issues by a fixed 97; a trailing window keeps the figure current.'
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- v_material_stock — the sheet's Stock Intelligence, as a view
--
-- Same first 24 columns as 0039 (CREATE OR REPLACE requires it); the derived
-- reorder columns are appended. Days are in IST, as everywhere else.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_material_stock AS
WITH stock AS (
  SELECT
    material_id,
    SUM(qty_remaining)                                        AS closing_stock,
    COUNT(*) FILTER (WHERE qty_remaining > 0)::integer        AS open_batches,
    MIN(received_date) FILTER (WHERE qty_remaining > 0)       AS oldest_open_batch
  FROM v_material_batch_stock
  GROUP BY material_id
),
consumption AS (
  -- What actually left the store inside the window. Adjustments are not
  -- consumption; a count correction says nothing about how fast a thing goes.
  SELECT
    b.material_id,
    SUM(i.qty)            AS issued_in_window,
    MAX(i.issued_on)      AS last_issue_on
  FROM material_issue i
  JOIN material_batch b ON b.id = i.batch_id
  WHERE i.deleted_at IS NULL
    AND b.deleted_at IS NULL
  GROUP BY b.material_id
),
window_issues AS (
  SELECT
    b.material_id,
    SUM(i.qty) AS qty
  FROM material_issue i
  JOIN material_batch b ON b.id = i.batch_id
  WHERE i.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND i.issued_on > today_ist() - app_setting_int('material_adc_window_days', 90)
  GROUP BY b.material_id
),
base AS (
  SELECT
    m.*,
    mc.name AS category_name,
    mt.name AS type_name,
    COALESCE(s.closing_stock, 0)    AS closing_stock_v,
    COALESCE(s.open_batches, 0)     AS open_batches_v,
    s.oldest_open_batch             AS oldest_open_batch_v,
    COALESCE(m.in_transit_qty, 0)   AS in_transit_v,
    c.last_issue_on,
    -- ADC: issued in the window / window days. Null when nothing was issued
    -- in the window — "no consumption data", not zero.
    CASE
      WHEN w.qty IS NULL OR w.qty <= 0 THEN NULL
      ELSE ROUND(w.qty / app_setting_int('material_adc_window_days', 90), 4)
    END AS adc
  FROM material m
  JOIN material_category mc ON mc.id = m.category_id
  JOIN material_type mt     ON mt.id = m.type_id
  LEFT JOIN stock s         ON s.material_id = m.id
  LEFT JOIN consumption c   ON c.material_id = m.id
  LEFT JOIN window_issues w ON w.material_id = m.id
  WHERE m.deleted_at IS NULL
),
derived AS (
  SELECT
    b.*,
    -- Max level = ADC × lead time × safety factor, the sheet's column O.
    CASE
      WHEN b.adc IS NOT NULL AND b.lead_time_days IS NOT NULL AND b.safety_factor IS NOT NULL
      THEN ROUND(b.adc * b.lead_time_days * b.safety_factor, 2)
    END AS max_level_calc,
    CASE WHEN b.adc IS NOT NULL AND b.adc > 0
      THEN ROUND((b.closing_stock_v + b.in_transit_v) / b.adc, 1)
    END AS days_remaining,
    CASE
      WHEN b.reorder_method = 'Interval' AND b.issue_interval_days IS NOT NULL AND b.last_issue_on IS NOT NULL
      THEN ROUND(b.issue_interval_days - (today_ist() - b.last_issue_on), 1)
    END AS days_to_issue
  FROM base b
),
status AS (
  SELECT
    d.*,
    CASE WHEN d.max_level_calc IS NOT NULL THEN ROUND(d.max_level_calc * 0.8, 2) END AS reorder_level,
    CASE
      WHEN NOT d.is_active                                   THEN 'Retired'
      WHEN d.reorder_method = 'On demand'                    THEN 'On demand'
      WHEN d.closing_stock_v <= 0                            THEN 'Critical – order now'
      WHEN d.reorder_method = 'Interval'
        AND d.issue_interval_days IS NULL                    THEN 'Set interval'
      WHEN d.reorder_method = 'Consumption'
        AND d.adc IS NULL                                    THEN 'No consumption data'
      WHEN d.reorder_method = 'Consumption'
        AND d.lead_time_days IS NOT NULL
        AND d.days_remaining <= d.lead_time_days             THEN 'Order now'
      WHEN d.reorder_method = 'Consumption'
        AND d.max_level_calc IS NOT NULL
        AND d.closing_stock_v + d.in_transit_v < d.max_level_calc * 0.8 THEN 'Low'
      ELSE 'OK'
    END AS stock_status
  FROM derived d
)
SELECT
  -- 0039's columns, same names, same order --------------------------------
  st.id                                   AS material_id,
  st.sku,
  st.name,
  st.category_id,
  st.category_name,
  st.type_id,
  st.type_name,
  st.size,
  st.gsm,
  st.colour,
  st.finish,
  st.unit,
  st.is_active,
  st.average_daily_consumption,
  st.lead_time_days,
  st.min_order_qty,
  st.max_level,
  st.in_transit_v                         AS in_transit_qty,
  st.closing_stock_v                      AS closing_stock,
  st.open_batches_v                       AS open_batches,
  st.oldest_open_batch_v                  AS oldest_open_batch,
  st.reorder_level,
  st.days_remaining,
  (st.stock_status IN ('Critical – order now', 'Order now', 'Low')) AS needs_reorder,

  -- appended in 0040 ------------------------------------------------------
  st.reorder_method,
  st.safety_factor,
  st.issue_interval_days,
  st.reorder_note,
  st.reorder_note_on,
  st.image_url,
  st.adc,
  st.max_level_calc,
  st.last_issue_on,
  st.days_to_issue,
  -- The sheet's "Operations check — due for issue": an Interval item whose
  -- last issue is older than its interval. Usually means nobody recorded it.
  (st.reorder_method = 'Interval' AND st.days_to_issue IS NOT NULL AND st.days_to_issue < 0) AS due_for_issue,
  CASE
    WHEN st.days_remaining IS NOT NULL AND st.lead_time_days IS NOT NULL
    THEN today_ist() + (FLOOR(st.days_remaining) - st.lead_time_days)::integer
  END                                     AS order_by_date,
  -- What to order, when something is: enough to reach max level, never less
  -- than the MOQ; an Interval item with no max level just gets its MOQ.
  CASE
    WHEN st.stock_status IN ('Critical – order now', 'Order now', 'Low') THEN
      GREATEST(
        COALESCE(st.min_order_qty, 0),
        CEIL(COALESCE(st.max_level_calc, 0) - st.closing_stock_v - st.in_transit_v)
      )
    ELSE 0
  END                                     AS suggested_order_qty,
  st.stock_status
FROM status st;
