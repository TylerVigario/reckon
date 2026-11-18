// A LINE KEEPS THE PIECES IT WAS TAXED BY (18 November 2026). A line taxed at
// its site's rate kept that rate and, beside it, the state's share and the
// districts' -- California's shape. Every state's rate is pieces by who levies
// them (tax_piece), so a line keeps the pieces of its site's area as they were
// when it was added: who levied what, federal, state or local, a list of
// {level, jurisdiction, rate} in tax_pieces. A snapshot, read whole, and frozen
// with the line when its invoice goes out, as every other field of it is.
//
// The rates are strings in the list, as a NUMERIC is everywhere else: inside
// JSON a number would be a float.
//
// Each line's shares become its pieces: the state's as CALIFORNIA's, and the
// districts' as its jurisdiction's, where it has any. That is a change of form
// and not an edit, so the triggers that freeze a sent line, count its saves
// and keep its history stand aside while it is made. A line taxed at its
// site's rate with no shares to make pieces of stops the migration: from here
// on every such line keeps its pieces, and none can be made up for it.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	// Whether a value is a list of pieces: each an object saying its level, who
	// levies it, and a rate of at most four places that is not negative, written
	// as a string.
	await sql`
		create function tax_pieces_are_pieces(pieces jsonb) returns boolean
		language sql immutable as $function$
		  SELECT jsonb_typeof(pieces) = 'array'
		     AND NOT EXISTS (
		       SELECT 1 FROM jsonb_array_elements(pieces) p
		        WHERE jsonb_typeof(p) <> 'object'
		           OR coalesce(p ->> 'level', '') NOT IN ('federal', 'state', 'local')
		           OR coalesce(btrim(p ->> 'jurisdiction'), '') = ''
		           OR jsonb_typeof(p -> 'rate') IS DISTINCT FROM 'string'
		           OR (p ->> 'rate') !~ '^\\d{1,3}(\\.\\d{1,4})?$')
		$function$`.execute(db);
	// What a list of pieces adds up to.
	await sql`
		create function tax_pieces_rate(pieces jsonb) returns numeric
		language sql immutable as $function$
		  SELECT coalesce(sum((p ->> 'rate')::numeric), 0) FROM jsonb_array_elements(pieces) p
		$function$`.execute(db);

	await sql`
		DO $$
		BEGIN
		  IF EXISTS (SELECT 1 FROM invoice_line
		              WHERE tax_source = 'site' AND taxable AND site_id IS NOT NULL
		                AND (state_rate_pct IS NULL OR district_rate_pct IS NULL)) THEN
		    RAISE EXCEPTION 'a line taxed at its site''s rate keeps no shares to make its pieces of'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'line_pieces_are_its_rate';
		  END IF;
		END $$`.execute(db);

	await db.schema.alterTable('invoice_line').addColumn('tax_pieces', 'jsonb').execute();

	await sql`alter table invoice_line disable trigger freeze_lines`.execute(db);
	await sql`alter table invoice_line disable trigger v_invoice_line`.execute(db);
	await sql`alter table invoice_line disable trigger h_invoice_line`.execute(db);
	await sql`
		update invoice_line
		   set tax_pieces = jsonb_build_array(
		         jsonb_build_object('level', 'state', 'jurisdiction', 'CALIFORNIA',
		                            'rate', state_rate_pct::text))
		       || case when district_rate_pct > 0
		               then jsonb_build_array(
		                      jsonb_build_object('level', 'local', 'jurisdiction', tax_jurisdiction,
		                                         'rate', district_rate_pct::text))
		               else '[]'::jsonb end
		 where tax_source = 'site' and taxable and site_id is not null`.execute(db);
	await sql`alter table invoice_line enable trigger freeze_lines`.execute(db);
	await sql`alter table invoice_line enable trigger v_invoice_line`.execute(db);
	await sql`alter table invoice_line enable trigger h_invoice_line`.execute(db);

	// The shares are the pieces now; their check goes with them.
	await db.schema
		.alterTable('invoice_line')
		.dropColumn('state_rate_pct')
		.dropColumn('district_rate_pct')
		.execute();
	// A line taxed at its site's rate keeps the pieces it was made of, and no
	// other line keeps any; and they are that rate.
	await db.schema
		.alterTable('invoice_line')
		.addCheckConstraint(
			'line_pieces_are_its_rate',
			sql`(tax_source = 'site' and taxable and site_id is not null) = (tax_pieces is not null)
				and (tax_pieces is null
					or (tax_pieces_are_pieces(tax_pieces) and tax_pieces_rate(tax_pieces) = tax_rate_pct))`
		)
		.execute();
}
