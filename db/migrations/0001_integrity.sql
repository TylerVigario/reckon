-- What the database enforces for every writer, written by hand because
-- Drizzle's schema cannot express it: two rules about invoices, a history of
-- every change, one foreign key, and the roles every operator starts with.
-- Everything else -- what an hour bills, what it pays, what a retainer
-- covers -- is calculated in $lib/server/valuation, not here.

-- A SENT INVOICE IS IMMUTABLE. Only its status, sent time, void reason and
-- link expiry may move once it has left draft.
CREATE FUNCTION freeze_sent_invoice() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF (to_jsonb(NEW) - 'status' - 'sent_at' - 'void_reason' - 'token_expires_on')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'sent_at' - 'void_reason' - 'token_expires_on') THEN
      RAISE EXCEPTION 'invoice % is % -- only its status may change. Correct it with a credit note.',
        OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION freeze_sent_invoice_lines() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM invoice WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'invoice % is % -- its lines are immutable. Correct it with a credit note.',
      COALESCE(NEW.invoice_id, OLD.invoice_id), st
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER freeze_invoice BEFORE UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION freeze_sent_invoice();
--> statement-breakpoint
CREATE TRIGGER freeze_lines BEFORE INSERT OR DELETE OR UPDATE ON invoice_line FOR EACH ROW EXECUTE FUNCTION freeze_sent_invoice_lines();
--> statement-breakpoint
-- EVERY CHANGE IS RECORDED, against whoever the application named in
-- reckon.user_id for the transaction.
CREATE FUNCTION record_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  k text;
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
BEGIN
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    IF o -> k IS DISTINCT FROM n -> k THEN
      INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, k, o ->> k, n ->> k, who);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION record_deletion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
BEGIN
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by)
  VALUES (TG_TABLE_NAME, OLD.id, '(deleted)', to_jsonb(OLD)::text, NULL, who);
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER h_entity AFTER UPDATE ON entity FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_service_price AFTER UPDATE ON service_price FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_pay_rule AFTER UPDATE ON pay_rule FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_material_lot AFTER UPDATE ON material_lot FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_time_entry AFTER UPDATE ON time_entry FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER d_time_entry AFTER DELETE ON time_entry FOR EACH ROW EXECUTE FUNCTION record_deletion();
--> statement-breakpoint
CREATE TRIGGER h_trip_leg AFTER UPDATE ON trip_leg FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_agreement AFTER UPDATE ON agreement FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_agreement_service AFTER UPDATE ON agreement_service FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_invoice AFTER UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER h_operator AFTER UPDATE ON operator FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
-- An agreement names only its own client's contact, and outlives them: only
-- contact_id empties, which Drizzle cannot say.
ALTER TABLE agreement
    ADD CONSTRAINT agreement_contact_is_the_clients FOREIGN KEY (entity_id, contact_id)
    REFERENCES entity_contact (entity_id, contact_id) ON DELETE SET NULL (contact_id);
--> statement-breakpoint
INSERT INTO role (name) VALUES ('Partner'), ('Employee'), ('Contractor');
