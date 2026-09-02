-- ---------------------------------------------------------------------------
-- job_card.machine_detail is dropped, two migrations after 0017 added it.
--
-- THIS IS THE ONLY DESTRUCTIVE MIGRATION IN THE PROJECT, and it is safe for a
-- specific reason rather than a general one. The column was added on 2 Sep
-- 2026 in 0017, was reachable only from the job card release form shipped the
-- same day, and has never existed on production — which was already two
-- migrations behind when 0017 landed. There is no data anywhere to lose.
--
-- It is replaced by job_card.machine_id, a foreign key to the seeded press
-- list (J10). Keeping both would be two answers to "which press", and the
-- wrong one would always be whichever nobody updated.
--
-- If this ever runs against a database that DID collect free text here, that
-- text is gone. Check before applying to anything but dev:
--   select count(*) from job_card where machine_detail is not null;
-- ---------------------------------------------------------------------------

ALTER TABLE "job_card" DROP COLUMN "machine_detail";