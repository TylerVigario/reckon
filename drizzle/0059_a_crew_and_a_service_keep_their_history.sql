-- A CREW AND A SERVICE KEEP THEIR HISTORY (14 November 2026).
--
-- Who was on a team entry is part of the entry, so each person put on its
-- crew or taken off is written to the entry's own history, field "crew", in
-- the save that did it: who joined as the new value, who left as the old.
-- One taken off with the entry itself is not: the entry's deletion says that.
--
-- And a service keeps its history as a material does: when it was added,
-- every field changed, and its deletion -- its prices and pay rules already
-- keep theirs.

CREATE TRIGGER a_service AFTER INSERT ON service FOR EACH ROW EXECUTE FUNCTION record_addition();--> statement-breakpoint
CREATE TRIGGER h_service AFTER UPDATE ON service FOR EACH ROW EXECUTE FUNCTION record_change();--> statement-breakpoint
CREATE TRIGGER d_service AFTER DELETE ON service FOR EACH ROW EXECUTE FUNCTION record_deletion();--> statement-breakpoint
CREATE FUNCTION record_crew() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
    VALUES ('time_entry', NEW.time_entry_id, 'crew', NULL, NEW.user_id::text, who, made);
    RETURN NEW;
  END IF;
  -- Taken off with the entry itself: its deletion says so.
  IF NOT EXISTS (SELECT 1 FROM time_entry WHERE id = OLD.time_entry_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
  VALUES ('time_entry', OLD.time_entry_id, 'crew', OLD.user_id::text, NULL, who, made);
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER h_time_entry_crew AFTER INSERT OR DELETE ON time_entry_crew
  FOR EACH ROW EXECUTE FUNCTION record_crew();
