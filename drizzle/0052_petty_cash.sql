-- ===========================================================================
-- Petty cash — the tin in the office (section CC).
--
-- Asked for by Utkarsh on 20 Nov 2026: "Add a daily petty cash entry record
-- and calculation visible only to accountant, owner and admin(of course). No
-- one else, and only accountant and owner can add data or remove data from it".
--
-- WHY THIS DOES NOT BREAK R1. R1 — "the money is tracked on Busy" — dropped
-- invoices, receipts, AR and the vendor bill because "postings belong where the
-- accountant already makes them". Asked directly whether Pradeep also posts
-- petty cash in Busy, Utkarsh's answer was no: the tin was a notebook. So this
-- is not a second copy of a Busy ledger, it is the first copy of something that
-- had no ledger at all, and R1's reason for existing — two books for the same
-- money and no way to say which is right — does not apply. CC1 writes that
-- down, because the next person to read R1 will wonder.
--
-- NOTHING IS STORED THAT CAN BE DERIVED. There is no balance column and no
-- opening-float setting. `petty_cash_balance_on(date)` is the single definition
-- of "how much was in the tin", `v_petty_cash_day` builds the day's sheet from
-- it, and the book starts empty so the first top-up IS the float. This is
-- non-negotiable 2's reasoning applied to money: a stored closing balance is
-- right the day it is written and wrong the first time somebody voids an entry,
-- and it looks equally authoritative on both days.
--
-- WHAT THE SHEET CANNOT DO. It cannot refuse an overdrawn tin. Blocking a
-- negative closing balance would mean computing the running balance on every
-- insert, and it would still be wrong the moment somebody backdates an entry
-- behind one already saved. So a negative closing is SHOWN, in red, as "the
-- book says the tin is overdrawn — a top-up is probably missing", which is the
-- same choice `client.credit_limit` made: warn, never block.
--
-- ADDITIVE. Two new tables, one new enum, one function, two views, three
-- triggers. Nothing existing is read or written by this migration, so the ten
-- existing views are untouched and every number on every existing screen reads
-- the same after it as before. Migrate first, then deploy.
-- ===========================================================================

CREATE TYPE "public"."petty_cash_direction" AS ENUM('In', 'Out');
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- petty_cash_head — what the money went on.
--
-- A seeded table rather than an enum, for the reason stages are a table: this
-- list grows when the factory's spending changes, and growing an enum needs a
-- migration while growing a table needs a row. Heads are deactivated by soft
-- delete, so an old entry's head still reads.
-- ---------------------------------------------------------------------------

CREATE TABLE "petty_cash_head" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL
);
--> statement-breakpoint

ALTER TABLE "petty_cash_head" ADD CONSTRAINT "petty_cash_head_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "petty_cash_head" ADD CONSTRAINT "petty_cash_head_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "petty_cash_head_code_key" ON "petty_cash_head" USING btree ("code") WHERE "petty_cash_head"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "petty_cash_head_sequence_idx" ON "petty_cash_head" USING btree ("sequence");
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- petty_cash — one row per movement of cash.
--
-- entry_date is THE DAY THE CASH MOVED, which is not the day it was typed.
-- Entries are written up the next morning, exactly as stage updates are, so
-- created_at answers a different question and the sheet must never use it.
-- ---------------------------------------------------------------------------

CREATE TABLE "petty_cash" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"entry_date" date NOT NULL,
	"direction" "petty_cash_direction" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"head_id" uuid,
	"party" text,
	"purpose" text NOT NULL,

	-- Required on the way OUT, refused on the way IN. Money arriving is a
	-- top-up and has no head; allowing one would put top-ups into the by-head
	-- spend total, which is the one figure this table exists to produce.
	--
	-- Explicit IS NULL / IS NOT NULL on every term — the 0046 lesson. A CHECK
	-- PASSES when its expression evaluates to NULL, so a pairing rule written
	-- without them is not a rule.
	CONSTRAINT "petty_cash_head_out_only" CHECK (
	  ("petty_cash"."direction" = 'Out' AND "petty_cash"."head_id" IS NOT NULL)
	  OR ("petty_cash"."direction" = 'In' AND "petty_cash"."head_id" IS NULL)
	),

	-- Zero is not a cash movement, and a negative is a direction typed into the
	-- wrong box. Both would land quietly in the balance.
	CONSTRAINT "petty_cash_amount_positive" CHECK ("petty_cash"."amount" > 0),

	-- A blank purpose is a row nobody can account for a month later, which is
	-- the only thing this table is for. NOT NULL does not catch a space.
	CONSTRAINT "petty_cash_purpose_not_blank" CHECK (length(btrim("petty_cash"."purpose")) > 0)
);
--> statement-breakpoint

ALTER TABLE "petty_cash" ADD CONSTRAINT "petty_cash_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "petty_cash" ADD CONSTRAINT "petty_cash_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "petty_cash" ADD CONSTRAINT "petty_cash_head_id_petty_cash_head_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."petty_cash_head"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "petty_cash_entry_date_idx" ON "petty_cash" USING btree ("entry_date");
--> statement-breakpoint
CREATE INDEX "petty_cash_head_idx" ON "petty_cash" USING btree ("head_id");
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- updated_at, which the audit wrapper does NOT set.
--
-- 0001 created this trigger for every table that existed then; the wrapper sets
-- updated_by and leaves updated_at to the database. Without this, a voided cash
-- entry would carry the updated_at of the day it was entered — and "when was
-- this voided" is precisely the question somebody asks of a cash book.
-- ---------------------------------------------------------------------------

CREATE TRIGGER petty_cash_head_touch_updated_at_trg
  BEFORE UPDATE ON petty_cash_head
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint

CREATE TRIGGER petty_cash_touch_updated_at_trg
  BEFORE UPDATE ON petty_cash
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- No entry dated in the future.
--
-- A cash entry is written up after the money moved, so tomorrow's date is a
-- typo — and a typo that silently breaks every balance after it, because the
-- figure lands in a day nobody will look at until it is wrong. This cannot be
-- a CHECK: today_ist() is not immutable, and Postgres refuses a CHECK that
-- calls a non-immutable function. A trigger is the only place to say it in the
-- database, and the database is where it belongs — the form says it too, but
-- the form is not the only way in.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION petty_cash_no_future_date() RETURNS trigger AS $$
BEGIN
  IF NEW.entry_date > today_ist() THEN
    RAISE EXCEPTION
      'petty cash entry is dated % , which is after today (%). Cash is recorded after it moves.',
      NEW.entry_date, today_ist()
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS petty_cash_no_future_date_trg ON petty_cash;
--> statement-breakpoint

CREATE TRIGGER petty_cash_no_future_date_trg
  BEFORE INSERT OR UPDATE OF entry_date ON petty_cash
  FOR EACH ROW EXECUTE FUNCTION petty_cash_no_future_date();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- The seven heads.
--
-- Chosen from what a packaging factory's tin actually pays for. OTHER exists
-- because the alternative to an escape hatch is somebody filing a courier
-- under conveyance, and a head that is wrong is worse than one that is vague.
-- ON CONFLICT DO NOTHING so a re-run cannot duplicate them, the same shape the
-- stage seeds use.
-- ---------------------------------------------------------------------------

INSERT INTO "petty_cash_head" ("code", "name", "sequence") VALUES
  ('CONVEYANCE', 'Conveyance',  10),
  ('FOOD',       'Food & tea',  20),
  ('LOADING',    'Loading & labour', 30),
  ('COURIER',    'Courier & postage', 40),
  ('STATIONERY', 'Stationery',  50),
  ('REPAIRS',    'Repairs & consumables', 60),
  ('OTHER',      'Other',       70)
ON CONFLICT DO NOTHING;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- petty_cash_balance_on — THE definition of how much was in the tin.
--
-- ONE definition, deliberately, and everything else reads it. The day's sheet
-- needs an opening and a closing figure; a month's history needs one per day;
-- a query for an arbitrary date needs one on demand. Written three times those
-- are three chances to disagree, and the moment two definitions of a balance
-- exist one of them is wrong — the same argument non-negotiable 2 makes about
-- pending_qty.
--
-- It is O(n) per call and the view below calls it twice per day with entries,
-- so a month's history is sixty scans of a table that will hold a few thousand
-- rows in its life. That is the trade taken on purpose: one definition over a
-- faster one, on a table whose size is bounded by how often a person opens a
-- cash tin.
--
-- VOIDED ENTRIES DO NOT COUNT. `deleted_at IS NULL` is what makes a void mean
-- something — the row stays for the audit trail and leaves the arithmetic.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION petty_cash_balance_on(p_date date) RETURNS numeric AS $$
  SELECT COALESCE(
    SUM(CASE WHEN pc.direction = 'In' THEN pc.amount ELSE -pc.amount END),
    0
  )::numeric(14,2)
  FROM petty_cash pc
  WHERE pc.deleted_at IS NULL
    AND p_date IS NOT NULL
    AND pc.entry_date <= p_date;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- v_petty_cash_day — one row per day that has entries.
--
-- Days with no movement do not appear, and that is correct for a history list.
-- The screen's own sheet asks for a specific date and reads
-- petty_cash_balance_on() directly, so a quiet day still renders with
-- yesterday's closing as its opening.
-- ---------------------------------------------------------------------------

CREATE VIEW v_petty_cash_day AS
WITH per_day AS (
  SELECT
    pc.entry_date,
    SUM(CASE WHEN pc.direction = 'In'  THEN pc.amount ELSE 0 END)::numeric(14,2) AS cash_in,
    SUM(CASE WHEN pc.direction = 'Out' THEN pc.amount ELSE 0 END)::numeric(14,2) AS cash_out,
    COUNT(*)::integer                                                            AS entries
  FROM petty_cash pc
  WHERE pc.deleted_at IS NULL
  GROUP BY pc.entry_date
)
SELECT
  d.entry_date,
  d.cash_in,
  d.cash_out,
  d.entries,
  (d.cash_in - d.cash_out)::numeric(14,2)        AS net,

  -- Opening is yesterday's closing, by definition rather than by a second sum.
  petty_cash_balance_on(d.entry_date - 1)        AS opening_balance,
  petty_cash_balance_on(d.entry_date)            AS closing_balance,

  -- The tin cannot physically hold less than nothing, so this means an entry
  -- is missing — almost always a top-up nobody wrote down. Shown, never
  -- blocked (see the header).
  (petty_cash_balance_on(d.entry_date) < 0)      AS overdrawn

FROM per_day d;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- v_petty_cash_head_month — where the month went.
--
-- The reason the heads are a fixed list rather than free text: this view is
-- impossible if the head is typed. OUT only — a top-up has no head, and the
-- CHECK above guarantees it has none to group by.
-- ---------------------------------------------------------------------------

CREATE VIEW v_petty_cash_head_month AS
SELECT
  date_trunc('month', pc.entry_date)::date AS month,
  h.id                                     AS head_id,
  h.code                                   AS head_code,
  h.name                                   AS head_name,
  h.sequence                               AS head_sequence,
  SUM(pc.amount)::numeric(14,2)            AS spent,
  COUNT(*)::integer                        AS entries
FROM petty_cash pc
JOIN petty_cash_head h ON h.id = pc.head_id
WHERE pc.deleted_at IS NULL
  AND pc.direction = 'Out'
GROUP BY 1, 2, 3, 4, 5;
