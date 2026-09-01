-- ===========================================================================
-- HAND-WRITTEN MIGRATION. Do not regenerate.
--
-- tooling.client_id is DERIVED from the design whenever one is linked.
--
-- The requirement says "derive from design when linked", and this is that rule
-- as a database trigger rather than as a line in a server action — the same
-- reasoning as F11. A rule that lives only in TypeScript is a rule the import
-- script does not have and a psql session does not have at all, and the
-- symptom of it being missed is silent: a die pointing at one client's design
-- while the register names a different client. Nobody notices until the tool
-- is sent to the wrong customer.
--
-- WHY client_id IS STORED AT ALL, rather than always read through the design:
-- tooling with no design can still belong to a client. Generic tooling for one
-- customer is real, so the column has to exist independently — and then the
-- linked case has to be kept honest, which is what this does.
--
-- BEFORE, not AFTER: the value is corrected on the way in, so the row is never
-- written wrong and there is no second UPDATE to audit.
-- ===========================================================================

CREATE OR REPLACE FUNCTION tooling_derive_client() RETURNS trigger AS $$
BEGIN
  IF NEW.design_id IS NOT NULL THEN
    SELECT d.client_id INTO NEW.client_id
    FROM design d
    WHERE d.id = NEW.design_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER tooling_derive_client_trg
  BEFORE INSERT OR UPDATE OF design_id, client_id ON tooling
  FOR EACH ROW
  EXECUTE FUNCTION tooling_derive_client();
