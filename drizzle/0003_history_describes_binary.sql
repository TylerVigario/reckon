-- A BINARY COLUMN IS DESCRIBED IN THE HISTORY, NOT COPIED INTO IT (#28).
-- record_change wrote every changed column as text. For operator.logo that
-- was the whole file in hex, once as the new value and again as the old one
-- at the next change: about a megabyte of history for a 512 KB logo, and more
-- with every upload, saying nothing a person reads. A bytea column now
-- records its length and its SHA-256 instead, which says that it changed,
-- how big it is and which file it was, and lets two uploads of the same file
-- be told apart from two different ones.
--
-- Rows already written are left as they are: they may hold the only copy of
-- a logo since replaced.

CREATE FUNCTION describe_bytes(hex text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN hex IS NULL THEN NULL
    ELSE ((length(hex) - 2) / 2)::text || ' bytes, sha256 '
         || encode(sha256(decode(substr(hex, 3), 'hex')), 'hex')
  END
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
  -- The table's bytea columns, which to_jsonb writes as hex: "\x89504e47...".
  blobs text[] := ARRAY(
    SELECT attname::text FROM pg_attribute
     WHERE attrelid = TG_RELID AND atttypid = 'bytea'::regtype
       AND attnum > 0 AND NOT attisdropped);
BEGIN
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    IF o -> k IS DISTINCT FROM n -> k THEN
      INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, k,
              CASE WHEN k = ANY (blobs) THEN describe_bytes(o ->> k) ELSE o ->> k END,
              CASE WHEN k = ANY (blobs) THEN describe_bytes(n ->> k) ELSE n ->> k END,
              who);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
