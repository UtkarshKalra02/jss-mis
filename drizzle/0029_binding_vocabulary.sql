-- ---------------------------------------------------------------------------
-- BINDING, from the paper job card (J23)
--
-- 0019 seeded the card's Fabrication Detail block verbatim and stopped there,
-- recording in its own header that BINDING was "deliberately NOT seeded — out
-- of scope by decision". It is in scope now: the card follows a job to the end,
-- and a bound book reaching the binder with no binding named is a question
-- somebody has to walk across the floor to ask.
--
-- It is a fabrication option like every other, rather than a band of its own,
-- so it inherits the machinery that already exists — the design picker, the
-- printed line carrying its answer, the design/run scope split. A second
-- mechanism holding four tick boxes would be a second place to look.
--
-- Design scope: how a book is bound is a property of the product, decided once
-- and reused every order, exactly like lamination. It does not change between
-- runs the way a die or a hybrid UV plate does.
--
-- Sequence 140 puts it after Side Pasting, which is where the paper card has
-- it: binding is the last thing that happens to the job.
--
-- Labels are VERBATIM from the card — "Perfect", "Side Stitch", "Centre
-- Stitch", "Hard Bound" — on 0019's rule that a guess printed on a floor
-- document reads as a fact (A2).
--
-- WRITTEN WITH `WHERE NOT EXISTS` RATHER THAN `ON CONFLICT`. The unique index
-- on fabrication_option.code is PARTIAL (`where deleted_at is null`, C5), and
-- ON CONFLICT only matches a partial index when the statement repeats its
-- predicate. NOT EXISTS says the same thing without depending on that, and
-- makes this migration replayable from any earlier point — the general rule
-- J16 cost an afternoon to learn.
-- ---------------------------------------------------------------------------

INSERT INTO fabrication_option (code, label, value_scope, allows_free_text, sequence)
SELECT 'BINDING', 'Binding', 'Design', false, 140
WHERE NOT EXISTS (
  SELECT 1 FROM fabrication_option WHERE code = 'BINDING' AND deleted_at IS NULL
);
--> statement-breakpoint

INSERT INTO fabrication_option_value (option_id, value, sequence)
SELECT o.id, v.value, v.seq
FROM fabrication_option o
JOIN (VALUES
  ('BINDING', 'Perfect',       10),
  ('BINDING', 'Side Stitch',   20),
  ('BINDING', 'Centre Stitch', 30),
  ('BINDING', 'Hard Bound',    40)
) AS v(code, value, seq) ON v.code = o.code
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM fabrication_option_value existing
    WHERE existing.option_id = o.id AND existing.value = v.value
  );
