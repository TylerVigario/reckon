-- A SECURITY EVENT STANDS (12 November 2026). The database stamps each one with
-- its own clock, whatever the row says; none is ever changed; and one is
-- removed only once it is a year old, which the server does itself every day
-- (#lib/server/events prune). Triggers rather than grants, so reckon names no
-- role (README, "The database"): only the table's owner could switch them off,
-- and the server's role owns nothing. TRUNCATE, which fires no delete trigger,
-- is not the server's to use.

CREATE FUNCTION security_event_stamped() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION security_event_stands() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.at < now() - interval '1 year' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'a security event stands: it is never %d, and removed only once a year old',
    lower(TG_OP) USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint

CREATE TRIGGER stamped BEFORE INSERT ON security_event
  FOR EACH ROW EXECUTE FUNCTION security_event_stamped();
--> statement-breakpoint

CREATE TRIGGER stands BEFORE UPDATE OR DELETE ON security_event
  FOR EACH ROW EXECUTE FUNCTION security_event_stands();
