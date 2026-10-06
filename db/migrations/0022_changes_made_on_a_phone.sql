-- A CHANGE MADE ON A PHONE with no signal reaches the server later, and the
-- server has to know whether anyone changed the line meanwhile: a line counts
-- its saves (version), and a change says which it started from. The history
-- keeps when such a change was made on the phone (made_at) beside when it
-- arrived (changed_at), from reckon.made_at as the application sets it for the
-- transaction, as it sets reckon.user_id.
--
-- A RECEIPT NOTHING ELSE HOLDS IS KEPT. 0003 and 0021 describe a binary column
-- in the history rather than copy it, because the row still holds the file.
-- A line taken off, and a receipt replaced by another, leave the history the
-- only place the photo could be: those are written whole, so a receipt -- the
-- evidence of a purchase that happened -- is never lost, and a line put back
-- can have it again.
ALTER TABLE "invoice_line" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "record_history" ADD COLUMN "made_at" timestamp with time zone;--> statement-breakpoint
CREATE FUNCTION bump_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (to_jsonb(NEW) - 'version') IS DISTINCT FROM (to_jsonb(OLD) - 'version') THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER v_invoice_line BEFORE UPDATE ON invoice_line FOR EACH ROW EXECUTE FUNCTION bump_version();
--> statement-breakpoint
-- The binary columns whose old value the history keeps whole.
CREATE FUNCTION history_keeps(tbl text, col text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT (tbl, col) IN (('invoice_line', 'receipt'), ('material_lot', 'receipt'))
$$;
--> statement-breakpoint
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
-- A row written whole, its binary columns described -- but for those the
-- history keeps, when `keep` says the row is going.
CREATE OR REPLACE FUNCTION describe_row(r jsonb, relid oid, keep boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE k text; tbl text := relid::regclass::text;
BEGIN
  FOR k IN SELECT attname::text FROM pg_attribute
            WHERE attrelid = relid AND atttypid = 'bytea'::regtype
              AND attnum > 0 AND NOT attisdropped LOOP
    -- jsonb_set answers null for a null value, so a column with nothing in it
    -- is written as JSON's null, not as SQL's.
    IF r ? k AND NOT (keep AND history_keeps(tbl, k)) THEN
      r := jsonb_set(r, ARRAY[k], coalesce(to_jsonb(describe_bytes(r ->> k)), 'null'::jsonb));
    END IF;
  END LOOP;
  RETURN r;
END $$;
--> statement-breakpoint
DROP FUNCTION describe_row(jsonb, oid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_addition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
BEGIN
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
  VALUES (TG_TABLE_NAME, NEW.id, '(added)', NULL,
          describe_row(to_jsonb(NEW), TG_RELID)::text, who, made);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_deletion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
BEGIN
  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
  VALUES (TG_TABLE_NAME, OLD.id, '(deleted)',
          describe_row(to_jsonb(OLD), TG_RELID, true)::text, NULL, who, made);
  RETURN OLD;
END $$;
