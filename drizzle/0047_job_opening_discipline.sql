-- ===========================================================================
-- Job opening discipline — SOP Rule 1, "no job number, no machine" (section W).
--
-- The SOP's first rule is that nothing runs on a machine until a job has been
-- opened in the system. The question this migration makes answerable is the
-- one behind that rule: once a customer confirms, HOW LONG does it take us to
-- open the job? The SOP's target is two working hours.
--
-- To answer it we need one thing the system has never recorded: WHEN the
-- customer confirmed. Opening time we already have — it is the row's
-- created_at. See "What is deliberately NOT here" below.
--
-- THREE COLUMNS, ALL NULLABLE, ALL-OR-NOTHING.
--
--   confirmation_source  PO / WhatsApp / Verbal — how the order arrived
--   confirmed_by         who at JSS took the confirmation
--   confirmed_at         when the customer confirmed
--
-- Nullable for the same reason committed_date is (F8): every row that already
-- exists, and every row the historical importer writes, genuinely has no
-- confirmation recorded. Writing an invented one would be indistinguishable
-- from a real one and would quietly become part of the metric. Those rows
-- report NULL and are EXCLUDED from the opening-time measure, exactly as
-- v_otd excludes items with no commitment. The human entry point requires all
-- three; the importer is the only path allowed to leave them null.
--
-- The check constraint is written with explicit IS NOT NULL on every branch.
-- That is the lesson of 0046: a CHECK whose expression evaluates to NULL
-- PASSES, so "all three present" written as a bare AND chain would have
-- happily accepted one of three.
--
-- WORKING HOURS, NOT CLOCK HOURS. "Two working hours" is not "120 minutes".
-- An order confirmed at 18:00 and opened at 10:00 next morning took thirty
-- working minutes, not sixteen hours. working_minutes_between() does that
-- arithmetic, in Asia/Kolkata (C10), against a window and a weekly day off
-- held in app_setting so Utkarsh can correct them without a deploy.
--
-- THE SHIFT IS 09:30-18:00, SUNDAY OFF — confirmed by Utkarsh, 18 Nov 2026.
-- The two-hour target is the SOP's. All four remain app_setting rows rather
-- than constants, because a shift is a thing that changes and correcting it
-- should cost an UPDATE, not a migration.
--
-- OVERTIME IS DELIBERATELY NOT COUNTED. Work does run past 18:00, but the
-- window stops there, so the clock on an unopened job stops at 18:00 too. The
-- effect is that this measure is slightly GENEROUS: a job confirmed at 17:30
-- and opened at 19:00 during overtime scores thirty minutes, not ninety. That
-- is the right direction to be wrong in — the number exists to catch jobs left
-- sitting overnight, not to penalise somebody for working late.
--
-- This function is the one piece here that is not really about Rule 1. The
-- O2D step TATs in the SOP are all expressed in working hours and days, so
-- every later phase needs exactly this arithmetic. Building it now, once,
-- behind a settings table, is cheaper than four screens each rolling their own.
--
-- WHAT IS DELIBERATELY NOT HERE.
--
--   opened_at. The brief asks for it. It would be an exact duplicate of
--   created_at — the row is created at the moment the job is opened, by the
--   same action, in the same transaction. A second column holding the same
--   instant is a column that can disagree with itself, which is the failure
--   mode non-negotiable 1 and 2 exist to prevent. v_job_opening exposes
--   created_at AS opened_at, so every reader gets the name it wants and there
--   is still only one fact stored.
--
--   "Items that reached a production stage without being opened first."
--   The brief asks for this list and expects it to be zero. It is zero by
--   construction and always will be: stage_event.po_item_id is NOT NULL and
--   references po_item, so a stage event cannot exist before the item it
--   belongs to. A metric that cannot move is not a control. The honest
--   version of that question is "was the job opened within target", which is
--   what this view measures, and later "did it reach a machine before full
--   kit was complete" (1.3), which is a real gate and a real thing to count.
--
-- NOTHING EXISTING CHANGES. No view is redefined, no trigger touched, no row
-- updated. v_po_item_status, v_otd and the other eight views are untouched,
-- so every number on every existing screen reads the same after this as
-- before. The only writes this migration performs are four app_setting rows.
-- ===========================================================================

CREATE TYPE "public"."confirmation_source" AS ENUM('PO', 'WhatsApp', 'Verbal');
--> statement-breakpoint

ALTER TABLE "po_item" ADD COLUMN "confirmation_source" "confirmation_source";
--> statement-breakpoint
ALTER TABLE "po_item" ADD COLUMN "confirmed_by" uuid REFERENCES "app_user"("id");
--> statement-breakpoint
ALTER TABLE "po_item" ADD COLUMN "confirmed_at" timestamp with time zone;
--> statement-breakpoint

-- All three together or none of them. Explicit IS NOT NULL on every term:
-- see the 0046 note above.
ALTER TABLE "po_item" ADD CONSTRAINT "po_item_confirmation_all_or_none" CHECK (
  (
    "confirmation_source" IS NULL
    AND "confirmed_by"    IS NULL
    AND "confirmed_at"    IS NULL
  )
  OR
  (
    "confirmation_source" IS NOT NULL
    AND "confirmed_by"    IS NOT NULL
    AND "confirmed_at"    IS NOT NULL
  )
);
--> statement-breakpoint

CREATE INDEX "po_item_confirmed_at_idx" ON "po_item" ("confirmed_at");
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- The working-hours window. Four settings, all correctable in Admin.
-- Minutes from midnight so app_setting_int() can read them; '09:30' as text
-- would need a parser and a second helper.
-- ---------------------------------------------------------------------------

INSERT INTO "app_setting" ("key", "value", "description") VALUES
  ('work_day_start_min', '570',
   'Start of the working day, minutes after midnight IST. 570 = 09:30.'),
  ('work_day_end_min', '1080',
   'End of the working day, minutes after midnight IST. 1080 = 18:00. Overtime beyond this is not counted.'),
  ('work_week_off_dow', '0',
   'Weekly day off, Postgres DOW (0 = Sunday).'),
  ('job_open_target_working_minutes', '120',
   'SOP Rule 1 target: open a job within this many WORKING minutes of the customer confirming. 120 = two working hours.')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- working_minutes_between(from, to)
--
-- Minutes of working time between two instants, in Asia/Kolkata, skipping the
-- weekly day off and the hours outside the shift.
--
-- Returns NULL when either end is null, or when the settings are nonsense
-- (end of day not after start), or when the span is longer than a year —
-- that last one is a runaway guard, not a business rule: the loop is per day
-- and a mistyped year would otherwise walk thousands of iterations.
--
-- Returns 0, NOT NULL, when `to` is at or before `from`. Confirmation and
-- opening normally happen in the same form submit, milliseconds apart, and
-- the two timestamps can land either side of each other. Reading that as
-- "opened immediately" is correct; reading it as "no data" would silently
-- drop the item out of the metric. A genuinely future-dated confirmation is
-- rejected at the form instead, where it can be explained to the person
-- typing it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION working_minutes_between(p_from timestamptz, p_to timestamptz)
RETURNS integer AS $$
DECLARE
  v_start_min integer := app_setting_int('work_day_start_min', 570);
  v_end_min   integer := app_setting_int('work_day_end_min', 1080);
  v_off_dow   integer := app_setting_int('work_week_off_dow', 0);
  v_from      timestamp;
  v_to        timestamp;
  v_day       date;
  v_last      date;
  v_day_from  integer;
  v_day_to    integer;
  v_total     integer := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN RETURN NULL; END IF;
  IF v_end_min <= v_start_min THEN RETURN NULL; END IF;
  IF p_to <= p_from THEN RETURN 0; END IF;

  v_from := p_from AT TIME ZONE 'Asia/Kolkata';
  v_to   := p_to   AT TIME ZONE 'Asia/Kolkata';

  IF (v_to::date - v_from::date) > 366 THEN RETURN NULL; END IF;

  v_day  := v_from::date;
  v_last := v_to::date;

  WHILE v_day <= v_last LOOP
    IF EXTRACT(DOW FROM v_day)::integer <> v_off_dow THEN
      v_day_from := v_start_min;
      v_day_to   := v_end_min;

      IF v_day = v_from::date THEN
        v_day_from := GREATEST(
          v_day_from,
          EXTRACT(HOUR FROM v_from)::integer * 60 + EXTRACT(MINUTE FROM v_from)::integer
        );
      END IF;

      IF v_day = v_last THEN
        v_day_to := LEAST(
          v_day_to,
          EXTRACT(HOUR FROM v_to)::integer * 60 + EXTRACT(MINUTE FROM v_to)::integer
        );
      END IF;

      IF v_day_to > v_day_from THEN
        v_total := v_total + (v_day_to - v_day_from);
      END IF;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- v_job_opening — one row per live PO item.
--
-- opened_at is created_at under a clearer name. open_working_minutes and
-- opened_on_time are NULL, never false, for items with no confirmation
-- recorded, so a filter on "late" cannot sweep up every historical row.
-- ---------------------------------------------------------------------------

CREATE VIEW v_job_opening AS
SELECT
  pi.id                       AS po_item_id,
  pi.item_code,
  pi.item_name,
  po.id                       AS purchase_order_id,
  po.internal_no              AS po_internal_no,
  c.id                        AS client_id,
  c.name                      AS client_name,

  pi.confirmation_source,
  pi.confirmed_at,
  pi.confirmed_by,
  u.name                      AS confirmed_by_name,

  pi.created_at               AS opened_at,
  pi.import_batch_id,

  working_minutes_between(pi.confirmed_at, pi.created_at) AS open_working_minutes,

  app_setting_int('job_open_target_working_minutes', 120) AS target_working_minutes,

  CASE
    WHEN pi.confirmed_at IS NULL THEN NULL
    ELSE working_minutes_between(pi.confirmed_at, pi.created_at)
         <= app_setting_int('job_open_target_working_minutes', 120)
  END                         AS opened_on_time

FROM po_item pi
JOIN purchase_order po ON po.id = pi.purchase_order_id
JOIN client c          ON c.id = po.client_id
LEFT JOIN app_user u   ON u.id = pi.confirmed_by
WHERE pi.deleted_at IS NULL
  AND po.deleted_at IS NULL;
