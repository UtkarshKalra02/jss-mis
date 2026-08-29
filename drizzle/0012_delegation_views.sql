-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- The two derived views behind the Delegation module.
--
-- ###########################################################################
-- #                                                                         #
-- #  ALL DATE ARITHMETIC HERE GOES THROUGH today_ist().                     #
-- #                                                                         #
-- #  Same rule as migration 0002 and for the same reason. "Is this task     #
-- #  overdue?" is asked at 9am in Okhla, which is 03:30 UTC — and at 11pm,  #
-- #  which is 17:30 UTC the same day. Compare against a UTC now() and a     #
-- #  task due today reads as overdue for part of every evening. Nobody      #
-- #  reports that as a bug; they just stop trusting the red.                #
-- #                                                                         #
-- ###########################################################################
--
-- days_late and is_overdue are computed HERE and stored nowhere, on the same
-- reasoning as pending_qty (non-negotiable 2). A stored "days late" is a
-- number that was true on the day it was written.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- v_delegation_status — one row per live delegated task
--
-- Carries the two derived numbers plus the names both screens need, so no
-- caller has to re-join app_user twice and none of them can disagree about
-- what "late" means.
-- ---------------------------------------------------------------------------

CREATE VIEW v_delegation_status AS
SELECT
  dt.id                                  AS delegation_task_id,
  dt.assigned_to,
  au_to.name                             AS assigned_to_name,
  au_to.username                         AS assigned_to_username,
  dt.assigned_by,
  au_by.name                             AS assigned_by_name,
  dt.task,
  dt.level,
  dt.date_given,
  dt.expected_date,
  dt.status,
  dt.completed_at,
  dt.blocker_note,

  /*
   * DAYS LATE.
   *
   * Completed first, and that order matters: once a task is done, its lateness
   * is a fact about the past and must stop moving. Reading the clock for a
   * finished task would make a job delivered two days late grow later every
   * morning, which is why the completed branch comes first and why
   * delegation_completed_at_only_when_done exists to stop a stale date being
   * read by it.
   *
   * greatest(0, ...) because early is not negative-late. A task finished a week
   * before it was due scores the same as one finished on the day — both were
   * on time, and rewarding earliness would push people to pad their dates.
   *
   * Cancelled is 0 and never counts (G3). It was withdrawn, not missed.
   */
  CASE
    WHEN dt.completed_at IS NOT NULL
      THEN GREATEST(0, dt.completed_at - dt.expected_date)
    WHEN dt.status IN ('Done', 'Cancelled')
      THEN 0
    ELSE GREATEST(0, today_ist() - dt.expected_date)
  END::integer                           AS days_late,

  /*
   * OVERDUE means "late RIGHT NOW and still open". A task finished late is not
   * overdue — it is finished. The two are different questions and the screens
   * ask both: My Tasks shows what is still owed, the scorecard shows what was
   * missed.
   *
   * NOT NULL by construction, deliberately: a null boolean disappears from both
   * WHERE is_overdue and WHERE NOT is_overdue, so a row would be invisible to
   * every filter at once.
   */
  (dt.status NOT IN ('Done', 'Cancelled')
     AND dt.expected_date < today_ist())  AS is_overdue,

  /* Negative until due, so "in 3 days" and "3 days late" are one number. */
  (today_ist() - dt.expected_date)::integer AS days_past_due,

  dt.created_at,
  dt.updated_at
FROM delegation_task dt
JOIN app_user au_to ON au_to.id = dt.assigned_to
JOIN app_user au_by ON au_by.id = dt.assigned_by
WHERE dt.deleted_at IS NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- v_delegation_scorecard — the executive meeting screen, per person
--
-- One row per person who has ever been delegated anything. Built on
-- v_delegation_status rather than on delegation_task, so "late" has exactly one
-- definition; recomputing it here is how the meeting and the task list start
-- disagreeing in front of everybody.
-- ---------------------------------------------------------------------------

CREATE VIEW v_delegation_scorecard AS
SELECT
  s.assigned_to                          AS app_user_id,
  s.assigned_to_name                     AS name,
  s.assigned_to_username                 AS username,

  /*
   * ASSIGNED EXCLUDES CANCELLED (decision G3), which is only safe because the
   * assignee cannot cancel their own task. If they could, cancelling the ones
   * they were about to miss would be the shortest route to 100%. Counting
   * cancellations instead would punish somebody forever for work that was
   * withdrawn from them, which is the opposite unfairness.
   */
  COUNT(*) FILTER (WHERE s.status <> 'Cancelled')::integer            AS assigned,
  COUNT(*) FILTER (WHERE s.status = 'Done')::integer                  AS done,
  COUNT(*) FILTER (WHERE s.status = 'Done' AND s.days_late = 0)::integer AS on_time,
  COUNT(*) FILTER (WHERE s.status = 'Done' AND s.days_late > 0)::integer AS late,
  COUNT(*) FILTER (
    WHERE s.status IN ('Not Started', 'In Progress', 'Blocked')
  )::integer                                                          AS open,
  COUNT(*) FILTER (WHERE s.is_overdue)::integer                       AS overdue_now,

  /*
   * SCORE is on_time over ASSIGNED, not over done — finishing nothing has to
   * score zero. Dividing by done would give somebody who completed one task on
   * time and abandoned nine a perfect 100%.
   *
   * NULL when there is nothing to score, never 0. "No score yet" and "scored
   * zero" are different statements, and on a screen read aloud in a meeting the
   * difference is somebody's reputation. The screen renders the null as an em
   * dash.
   */
  CASE
    WHEN COUNT(*) FILTER (WHERE s.status <> 'Cancelled') = 0 THEN NULL
    ELSE ROUND(
      100.0 * COUNT(*) FILTER (WHERE s.status = 'Done' AND s.days_late = 0)
            / COUNT(*) FILTER (WHERE s.status <> 'Cancelled')
    )
  END::integer                                                        AS score_pct,

  /* Read aloud as "and on average N days late when late". */
  COALESCE(
    ROUND(AVG(s.days_late) FILTER (WHERE s.status = 'Done' AND s.days_late > 0), 1),
    0
  )::numeric(6,1)                                                     AS avg_days_late
FROM v_delegation_status s
GROUP BY s.assigned_to, s.assigned_to_name, s.assigned_to_username;
