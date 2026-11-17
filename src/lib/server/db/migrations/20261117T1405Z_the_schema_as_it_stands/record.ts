// EVERY CHANGE IS RECORDED, against whoever the application named in
// reckon.user_id for the transaction (#lib/server/db, asUser).
//
// A table whose changes are kept has three triggers (recorded, below): each
// row added is written whole, as JSON -- what it was when it began, so its
// history starts there; each field changed, from what to what; and, where a
// row may go, the row as it went. The history (record_history, operator.ts)
// is written by these triggers alone, stamped with the database's own clock
// and the transaction it was part of, and never changed or removed.
//
// A CHANGE MADE ON A PHONE with no signal reaches the server later: the
// history keeps when it was made there (made_at, from reckon.made_at) beside
// when it arrived (changed_at). And a row counts its saves (version), so a
// change says which save it started from and the server can tell whether
// anyone changed the row meanwhile.
//
// A BINARY COLUMN IS DESCRIBED IN THE HISTORY, NOT COPIED INTO IT: its length
// and its SHA-256, which say that it changed, how big it is and which file it
// was -- a logo once in hex was a megabyte of history for a 512 KB file. But
// a receipt nothing else holds is kept: a line taken off, or a receipt
// replaced by another, leaves the history the only place it could be, so
// those are written whole, and the evidence of a purchase is never lost.
import { sql, type Kysely } from 'kysely';

export async function record(db: Kysely<any>): Promise<void> {
	await sql`
		create function describe_bytes(hex text) returns text
		language sql immutable as $function$
		  SELECT CASE WHEN hex IS NULL THEN NULL
		    ELSE ((length(hex) - 2) / 2)::text || ' bytes, sha256 '
		         || encode(sha256(decode(substr(hex, 3), 'hex')), 'hex')
		  END
		$function$`.execute(db);

	// The binary columns whose old value the history keeps whole.
	await sql`
		create function history_keeps(tbl text, col text) returns boolean
		language sql immutable as $function$
		  SELECT (tbl, col) IN (('invoice_line', 'receipt'), ('stock_receipt', 'receipt'))
		$function$`.execute(db);

	// A row written whole, its binary columns described -- but for those the
	// history keeps, when `keep` says the row is going.
	await sql`
		create function describe_row(r jsonb, relid oid, keep boolean default false) returns jsonb
		language plpgsql stable as $function$
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
		END $function$`.execute(db);

	await sql`
		create function record_addition() returns trigger
		language plpgsql as $function$
		DECLARE
		  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
		  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
		BEGIN
		  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
		  VALUES (TG_TABLE_NAME, NEW.id, '(added)', NULL,
		          describe_row(to_jsonb(NEW), TG_RELID)::text, who, made);
		  RETURN NEW;
		END $function$`.execute(db);

	// Each field changed, but for those the trigger names: when a person last
	// signed in, say, is not a change to them.
	await sql`
		create function record_change() returns trigger
		language plpgsql as $function$
		DECLARE
		  k text;
		  o jsonb := to_jsonb(OLD);
		  n jsonb := to_jsonb(NEW);
		  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
		  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
		  -- The table's bytea columns, which to_jsonb writes as hex: "\\x89504e47...".
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
		END $function$`.execute(db);

	await sql`
		create function record_deletion() returns trigger
		language plpgsql as $function$
		DECLARE
		  who uuid := nullif(current_setting('reckon.user_id', true), '')::uuid;
		  made timestamptz := nullif(current_setting('reckon.made_at', true), '')::timestamptz;
		BEGIN
		  INSERT INTO record_history (table_name, row_id, field, old_value, new_value, changed_by, made_at)
		  VALUES (TG_TABLE_NAME, OLD.id, '(deleted)',
		          describe_row(to_jsonb(OLD), TG_RELID, true)::text, NULL, who, made);
		  RETURN OLD;
		END $function$`.execute(db);

	// A save that changed something counts one more; one that changed nothing
	// does not.
	await sql`
		create function bump_version() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF (to_jsonb(NEW) - 'version') IS DISTINCT FROM (to_jsonb(OLD) - 'version') THEN
		    NEW.version := OLD.version + 1;
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
}

/**
 * Has `table`'s changes kept: each row added, each field changed (but for the
 * fields `ignoring` names), and, where `removals`, each row as it went.
 */
export async function recorded(
	db: Kysely<any>,
	table: string,
	{ ignoring = [], removals = false }: { ignoring?: string[]; removals?: boolean } = {}
): Promise<void> {
	await sql`create trigger ${sql.id(`a_${table}`)} after insert on ${sql.table(table)}
		for each row execute function record_addition()`.execute(db);
	await sql`create trigger ${sql.id(`h_${table}`)} after update on ${sql.table(table)}
		for each row execute function record_change(${sql.join(ignoring.map((f) => sql.lit(f)))})`.execute(
		db
	);
	if (removals)
		await sql`create trigger ${sql.id(`d_${table}`)} after delete on ${sql.table(table)}
			for each row execute function record_deletion()`.execute(db);
}

/** Has `table` count its saves, in its `version` column. */
export async function versioned(db: Kysely<any>, table: string): Promise<void> {
	await sql`create trigger ${sql.id(`v_${table}`)} before update on ${sql.table(table)}
		for each row execute function bump_version()`.execute(db);
}
