// A PIECE FOR ONE KIND OF SALE (21 November 2026). Most of what a place levies
// falls on every kind of sale its state taxes. Some falls on one kind alone,
// and where the state does not tax that kind, it falls there all the same:
//
//   a Massachusetts town adds 0.75% to restaurant meals, which the state
//   taxes too (M.G.L. c. 64L s. 2);
//   New York City taxes barbering, manicures and the like at 4.5%, which
//   the state does not tax at all (Form ST-810.5, Schedule N);
//   a Colorado town may tax the food the state exempts (CDOR, Sales 4).
//
// So a piece of a typed area can be for one kind of sale. A line of that kind
// taxed at its site's rate keeps the piece, whether or not its state taxes the
// kind; a line of any other kind does not. Every other piece falls, as before,
// on every kind the state taxes. CDTFA's pieces are California's state share
// and its districts', which fall on everything California taxes, so a piece
// for one kind is a typed one.
//
// A jurisdiction levies once on every kind in a set, as before, and once more
// on each kind it taxes alone: Richmond, Virginia, levies its 1% local sales
// tax and a meals tax of its own.
//
// A line keeps a piece for one kind with the kind it was for, its own.
//
// Nothing is a piece for one kind before: every piece stays on every kind.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('tax_piece')
		/** The one kind of sale it falls on, or null for every kind its state taxes. */
		.addColumn('sale_kind_id', 'uuid', (c) => c.references('sale_kind.id').onDelete('restrict'))
		.execute();
	// An authority's pieces fall on everything its state taxes: a piece for
	// one kind is a person's, typed from the state's table.
	await db.schema
		.alterTable('tax_piece')
		.addCheckConstraint(
			'a_piece_for_one_kind_is_typed',
			sql`sale_kind_id is null or typed_by is not null`
		)
		.execute();
	// A jurisdiction levies once on every kind in a set, and once on each kind
	// it taxes alone.
	await db.schema.alterTable('tax_piece').dropConstraint('tax_piece_once_in_a_set').execute();
	await db.schema
		.alterTable('tax_piece')
		.addUniqueConstraint(
			'tax_piece_once_in_a_set',
			['area_id', 'effective_from', 'level', 'jurisdiction', 'sale_kind_id'],
			(c) => c.nullsNotDistinct()
		)
		.execute();
	await db.schema
		.createIndex('tax_piece_by_sale_kind')
		.on('tax_piece')
		.column('sale_kind_id')
		.execute();

	// Whether each of a line's pieces for one kind is for `kind`, the kind the
	// line was sold as: a piece with no kind falls on every kind.
	await sql`
		create function tax_pieces_are_for(pieces jsonb, kind uuid) returns boolean
		language sql immutable as $function$
		  SELECT NOT EXISTS (
		    SELECT 1 FROM jsonb_array_elements(pieces) p
		     WHERE p ? 'kind' AND (p ->> 'kind') IS DISTINCT FROM kind::text)
		$function$`.execute(db);
	await db.schema
		.alterTable('invoice_line')
		.addCheckConstraint(
			'line_pieces_are_for_its_kind',
			sql`tax_pieces is null or tax_pieces_are_for(tax_pieces, sale_kind_id)`
		)
		.execute();
}
