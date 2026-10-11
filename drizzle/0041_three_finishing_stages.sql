-- ===========================================================================
-- Three finishing stages the floor actually runs (section R).
--
-- Asked for by Utkarsh on 11 Oct 2026: embossing is a stage, Hybrid UV and
-- Spot UV are DIFFERENT PROCESSES rather than one 'UV', and emboss + die cut
-- done in a single pass is its own thing.
--
-- WHY THE EXISTING 'UV' STAGE IS LEFT ALONE. Stage codes are immutable (C2) —
-- stage_event references them by value, so renaming one rewrites the history
-- of every item that passed through it. 'UV' also already covers both Full and
-- Spot: the fabrication vocabulary (0019) has option UV with values Full and
-- Spot, and Hybrid UV as a SEPARATE option because the hybrid plate is a fact
-- about the run. This migration brings the stage list in line with a
-- distinction the fabrication vocabulary has drawn since 0019 — Hybrid UV
-- becomes its own stage; UV keeps covering full and spot coating.
--
-- SEQUENCE. Numbered inside the gaps the tens left (0003), so nothing is
-- renumbered and no existing stage moves:
--   UV 90 → HYBRID_UV 95 → FOILING 100 → EMBOSSING 105 → DIE_CUT 110 →
--   EMBOSS_DIE_CUT 115 → PASTING 120.
-- EMBOSS_DIE_CUT sits after DIE_CUT because it is an ALTERNATIVE to it, not a
-- step following it — a job takes one route or the other.
--
-- OPTIONAL. All three are true, like LAMINATION, UV, FOILING and PASTING.
-- Note DIE_CUT itself is NOT optional while EMBOSS_DIE_CUT is, which is
-- correct: every job is die cut, by one route or the other.
--
-- TARGET HOURS ARE NULL, DELIBERATELY, AND THIS IS NOT AN OVERSIGHT.
-- The seeded targets on the original fourteen are placeholders from an example
-- workbook, never measured on the floor (A2). Rather than invent three more,
-- these are left null: v_wip_ageing already renders is_over_target as NULL
-- when target_hours is null, which reads as "not known" instead of "fine" —
-- the same handling READY and DISPATCHED get. Admin › Stages is where a human
-- puts a real number in, and target_hours_verified then stops it being
-- mistaken for a guess. A null target is more honest than a fabricated one.
--
-- COLOUR follows the ramp 0003 set: each family starts light and darkens
-- through the workflow. HYBRID_UV takes blue-900, closing the blue finishing
-- run; EMBOSSING opens the cyan post-press family at cyan-500; EMBOSS_DIE_CUT
-- takes cyan-800 — deeper than PASTING's cyan-700 because it is a branch off
-- DIE_CUT rather than a later step.
--
-- is_process defaults true and is correct for all three: these are things that
-- happen to paper, so they belong on a design's route (0007).
--
-- DATA ONLY. No schema change, nothing to deploy first, and ON CONFLICT makes
-- it safe to re-run.
-- ===========================================================================

INSERT INTO stage (code, name, sequence, is_optional, is_process, applies_to, target_hours, target_hours_verified, colour)
VALUES
  ('HYBRID_UV',      'Hybrid UV',       95,  true, true, 'All', NULL, false, '#1e3a8a'),
  ('EMBOSSING',      'Embossing',       105, true, true, 'All', NULL, false, '#06b6d4'),
  ('EMBOSS_DIE_CUT', 'Emboss + Die Cut',115, true, true, 'All', NULL, false, '#155e75')
ON CONFLICT (code) DO NOTHING;
