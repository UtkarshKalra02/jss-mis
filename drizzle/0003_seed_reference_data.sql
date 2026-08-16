-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- Reference data: the SYSTEM user, the stage table, and tunable settings.
--
-- This is configuration, not business data, which is why it ships as SQL in a
-- migration rather than through the audit wrapper. Audit history begins with
-- the application. (The Phase 2 historical import is different — that one is a
-- TypeScript script and DOES write audit rows, per decision C4, or the audit
-- trail has a hole exactly where the old data arrived.)
--
-- Every insert is idempotent (ON CONFLICT DO NOTHING) so re-running against a
-- partially seeded database is safe.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- SYSTEM user (decision C4)
--
-- Nightly recomputes, seeds, and import scripts have no logged-in user but
-- still have to attribute their writes. They act as this row.
--
-- The id is fixed rather than random so application code can reference it as a
-- constant (see src/db/audit.ts) without a lookup.
--
-- It cannot log in: password_hash is NULL, which the credentials provider
-- treats as "no usable password", and is_active is false. Both, deliberately —
-- either alone would be enough, and neither costs anything.
-- ---------------------------------------------------------------------------

INSERT INTO app_user (id, username, name, email, role, password_hash, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system',
  'System',
  NULL,
  'ADMIN',
  NULL,
  false
)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- stage (spec 4.1)
--
-- ###########################################################################
-- #  target_hours BELOW ARE PLACEHOLDERS.                                   #
-- #                                                                         #
-- #  They were copied from an example workbook and have NEVER been measured #
-- #  on the factory floor. They feed the WIP-ageing "over target" flag, so  #
-- #  acting on them before they are checked means acting on a guess.        #
-- #                                                                         #
-- #  target_hours_verified is therefore false on every row. The Admin       #
-- #  screen shows "unverified" beside any stage still in that state, and    #
-- #  clears the flag when a human edits the value. A comment in a migration #
-- #  is not enough on its own: the people reading the screen are not the    #
-- #  people reading this file.                                              #
-- ###########################################################################
--
-- sequence is numbered in tens so a stage can be inserted between two
-- existing ones later without renumbering the table.
--
-- applies_to describes the JOB, not the client (decision B4): ENQUIRY and
-- COSTING are skipped for a repeat run, but a repeat CLIENT placing a new job
-- still goes through both.
--
-- colour encodes progress through the workflow rather than decorating it,
-- which is the only use of colour section 7 permits: slate for pre-order,
-- sky for design, blue for press and finishing, cyan for post-press, green for
-- terminal states. Rendered at 12% opacity behind solid text.
-- ---------------------------------------------------------------------------

INSERT INTO stage (code, name, sequence, is_optional, applies_to, target_hours, target_hours_verified, colour)
VALUES
  ('ENQUIRY',        'Enquiry',        10,  false, 'New',    4,  false, '#94a3b8'),
  ('COSTING',        'Costing',        20,  false, 'New',    8,  false, '#64748b'),
  ('PO_RECEIVED',    'PO Received',    30,  false, 'All',    24, false, '#475569'),
  ('DESIGN',         'Design',         40,  false, 'All',    24, false, '#38bdf8'),
  ('APPROVED',       'Approved',       50,  false, 'All',    8,  false, '#0284c7'),
  ('MATERIAL_READY', 'Material Ready', 60,  false, 'All',    4,  false, '#60a5fa'),
  ('PRINTING',       'Printing',       70,  false, 'All',    6,  false, '#2563eb'),
  ('LAMINATION',     'Lamination',     80,  true,  'All',    4,  false, '#3b82f6'),
  ('UV',             'UV',             90,  true,  'All',    4,  false, '#1d4ed8'),
  ('FOILING',        'Foiling',        100, true,  'All',    6,  false, '#1e40af'),
  ('DIE_CUT',        'Die Cut',        110, false, 'All',    4,  false, '#0891b2'),
  ('PASTING',        'Pasting',        120, true,  'All',    4,  false, '#0e7490'),
  ('READY',          'Ready',          130, false, 'All',    0,  false, '#16a34a'),
  ('DISPATCHED',     'Dispatched',     140, false, 'All',    0,  false, '#15803d')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- app_setting (decision B3)
--
-- Thresholds ADMIN can tune without a deploy. Read by the views through
-- app_setting_int(), which falls back to the same default if a row is missing,
-- so deleting a setting degrades to sane behaviour rather than breaking.
-- ---------------------------------------------------------------------------

INSERT INTO app_setting (key, value, description)
VALUES (
  'at_risk_window_days',
  '3',
  'An open item counts as at risk when its committed date falls within this many days and it has not reached READY. Drives the dashboard at-risk list. Separate from stage.target_hours, which flags an item sitting too long in one stage.'
)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- number_series (decision C7)
--
-- Deliberately NOT seeded. Series are created on demand by the allocator in
-- src/lib/numbering.ts, which upserts the row for the current financial year
-- the first time a document of that type is raised. Seeding them here would
-- mean adding rows every April, which is a job nobody would remember to do.
-- ---------------------------------------------------------------------------
