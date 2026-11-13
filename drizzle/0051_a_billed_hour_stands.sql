-- A TIME ENTRY IS CHANGED AFTER THE FACT, UNTIL IT IS BILLED OR PAID (12 November
-- 2026). Whoever entered it, or someone with Full, changes it on its own screen
-- (#routes/api/time/[id] PATCH); each save counts (version), so a change made
-- from an old copy is told someone changed it meanwhile, and history keeps
-- every field it changed, but not the count.
--
-- One an invoice was built from, or a payment recorded, stays as it was: the
-- invoice and the pay say what it was then, and a changed hour would leave them
-- saying something else. Removing one is already refused for the same reason
-- (invoice_line and person_payment_item reference it ON DELETE RESTRICT); this
-- refuses changing one. It is put right where it was used: taken off the
-- draft, credited on a sent invoice, or corrected on the next payment.

CREATE TRIGGER v_time_entry BEFORE UPDATE ON time_entry
  FOR EACH ROW EXECUTE FUNCTION bump_version();
--> statement-breakpoint

DROP TRIGGER h_time_entry ON time_entry;
--> statement-breakpoint
CREATE TRIGGER h_time_entry AFTER UPDATE ON time_entry
  FOR EACH ROW EXECUTE FUNCTION record_change('version');
--> statement-breakpoint

CREATE FUNCTION a_billed_hour_stands() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoice_line WHERE time_entry_id = OLD.id) THEN
    RAISE EXCEPTION 'time entry % is on an invoice, so it stays as it was billed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM person_payment_item WHERE time_entry_id = OLD.id) THEN
    RAISE EXCEPTION 'time entry % is in a payment, so it stays as it was paid', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER a_billed_hour_stands BEFORE UPDATE ON time_entry
  FOR EACH ROW EXECUTE FUNCTION a_billed_hour_stands();
