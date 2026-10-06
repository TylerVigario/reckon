-- EVERY LINE KEEPS ITS WHOLE HISTORY: who added it and what it was, each field
-- changed from what to what, and its removal, against whoever the application
-- named in reckon.user_id (0001). invoice_line joins the tables record_history
-- follows, and is the first followed from its birth.
--
-- A row added or removed is written whole, as JSON, with its binary columns
-- described as 0003 describes them -- a receipt is its length and its SHA-256,
-- never the photo again.

CREATE FUNCTION describe_row(r jsonb, relid oid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE k text;
BEGIN
  FOR k IN SELECT attname::text FROM pg_attribute
            WHERE attrelid = relid AND atttypid = 'bytea'::regtype
              AND attnum > 0 AND NOT attisdropped LOOP
    -- jsonb_set answers null for a null value, so a column with nothing in it
    -- is written as JSON's null, not as SQL's.
    IF r ? k THEN
      r := jsonb_set(r, ARRAY[k], coalesce(to_jsonb(describe_bytes(r ->> k)), 'null'::jsonb));
    END IF;
  END LOOP;
  RETURN r;
END $$;
--> statement-breakpoint
CREATE FUNCTION record_addition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
BEGIN
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by)
  VALUES (TG_TABLE_NAME, NEW.id, '(added)', NULL,
          describe_row(to_jsonb(NEW), TG_RELID)::text, who);
  RETURN NEW;
END $$;
--> statement-breakpoint
-- What went is described the same way: a time entry has nothing binary, and is
-- written as before.
CREATE OR REPLACE FUNCTION record_deletion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
BEGIN
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by)
  VALUES (TG_TABLE_NAME, OLD.id, '(deleted)',
          describe_row(to_jsonb(OLD), TG_RELID)::text, NULL, who);
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER a_invoice_line AFTER INSERT ON invoice_line FOR EACH ROW EXECUTE FUNCTION record_addition();
--> statement-breakpoint
CREATE TRIGGER h_invoice_line AFTER UPDATE ON invoice_line FOR EACH ROW EXECUTE FUNCTION record_change();
--> statement-breakpoint
CREATE TRIGGER d_invoice_line AFTER DELETE ON invoice_line FOR EACH ROW EXECUTE FUNCTION record_deletion();
