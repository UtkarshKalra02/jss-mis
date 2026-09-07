-- ---------------------------------------------------------------------------
-- Nobody delegates to an OWNER — decision J26.
--
-- The rule is about the ROLE, not about one person. An owner who can be
-- assigned work from a form is an org chart that anybody with the delegation
-- screen can rewrite upwards.
--
-- IT IS A TRIGGER RATHER THAN A CHECK because the answer lives in another
-- table: `delegation_task` stores a user id and the role is on `app_user`. A
-- CHECK constraint cannot read a second table, and denormalising the role onto
-- the task would create a second copy that goes stale the day somebody's role
-- changes — the failure I7 removed `design.die_id` over.
--
-- It sits beside the application rule and the audit wrapper's, and that is the
-- point of non-negotiable 4: the form's rule is a rule until somebody writes a
-- script, and this one is true for psql, an import and a future screen that
-- forgets.
--
-- Fires on INSERT and on UPDATE OF assigned_to, so a task cannot be MOVED onto
-- an owner either. Reassignment is the back door that a create-only check would
-- have left standing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delegation_refuse_owner_assignee()
RETURNS trigger AS $$
DECLARE
  v_role text;
  v_name text;
BEGIN
  SELECT role, name INTO v_role, v_name
    FROM app_user
   WHERE id = NEW.assigned_to;

  IF v_role = 'OWNER' THEN
    RAISE EXCEPTION
      'Tasks cannot be delegated to % — delegation runs downwards (J26).',
      coalesce(v_name, 'an owner')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS delegation_task_no_owner_assignee_trg ON delegation_task;
--> statement-breakpoint

CREATE TRIGGER delegation_task_no_owner_assignee_trg
  BEFORE INSERT OR UPDATE OF assigned_to ON delegation_task
  FOR EACH ROW EXECUTE FUNCTION delegation_refuse_owner_assignee();
