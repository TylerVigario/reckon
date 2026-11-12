-- HISTORY COVERS PEOPLE, AND EVERY ROW ADDED, AND STANDS (12 November 2026).
--
-- A person's name, address, role, access and whether they are active are kept
-- as every other record's are; when they last signed in, and Better Auth's own
-- updated_at, are not changes to them. record_change leaves out whatever
-- fields its trigger names.
--
-- Every table whose changes are kept now keeps each row added too, as
-- invoice_line's always has (record_addition): what it was when it began, so
-- its history starts there.
--
-- And history is written by those triggers alone -- a row inserted any other
-- way is refused -- stamped with the database's own clock and the transaction
-- it was part of, and never changed or removed. Triggers rather than grants,
-- so reckon names no role (README, "The database"): only the table's owner
-- could switch them off, and the server's role owns nothing.

CREATE OR REPLACE FUNCTION record_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  k text;
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
  -- The table's bytea columns, which to_jsonb writes as hex: "\x89504e47...".
  blobs text[] := ARRAY(
    SELECT attname::text FROM pg_attribute
     WHERE attrelid = TG_RELID AND atttypid = 'bytea'::regtype
       AND attnum > 0 AND NOT attisdropped);
BEGIN
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    -- A field the trigger names is not one whose changes are kept.
    CONTINUE WHEN k = ANY (TG_ARGV);
    IF o -> k IS DISTINCT FROM n -> k THEN
      INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
      VALUES (TG_TABLE_NAME, NEW.id, k,
              CASE WHEN k = ANY (blobs) AND NOT history_keeps(TG_TABLE_NAME, k)
                   THEN describe_bytes(o ->> k) ELSE o ->> k END,
              CASE WHEN k = ANY (blobs) THEN describe_bytes(n ->> k) ELSE n ->> k END,
              who, made);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER h_user AFTER UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION record_change('updated_at', 'last_signed_in_at');
--> statement-breakpoint
CREATE TRIGGER a_user AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_entity AFTER INSERT ON entity FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_service_price AFTER INSERT ON service_price FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_pay_rule AFTER INSERT ON pay_rule FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_material_lot AFTER INSERT ON material_lot FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_time_entry AFTER INSERT ON time_entry FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_trip_leg AFTER INSERT ON trip_leg FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_agreement AFTER INSERT ON agreement FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_agreement_service AFTER INSERT ON agreement_service FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_invoice AFTER INSERT ON invoice FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER a_operator AFTER INSERT ON operator FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint

CREATE FUNCTION history_from_triggers() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'record_history is written by the tables'' own triggers, not directly'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.changed_at := now();
  NEW.xact := pg_current_xact_id()::text::bigint;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION history_stands() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'record_history stands: it is never %d', lower(TG_OP)
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint

CREATE TRIGGER from_triggers BEFORE INSERT ON record_history
  FOR EACH ROW EXECUTE FUNCTION history_from_triggers();
--> statement-breakpoint
CREATE TRIGGER stands BEFORE UPDATE OR DELETE ON record_history
  FOR EACH ROW EXECUTE FUNCTION history_stands();
