// A PERSON TYPES A STATE'S AREAS, AND CHOOSES A SITE'S (18 November 2026).
// Where no authority answers for an address, a business that collects in a
// state types that state's areas in from its own table -- each with a name,
// the state's code for it where it has one, and its pieces from a day -- and
// a person chooses which of them a site is in, from the state's own lookup.
//
//   AN AREA SAYS WHO TYPED IT, AND WHO LAST CONFIRMED IT: a typed area is
//   stale once nobody has confirmed it since a quarter began, which is when
//   the Streamlined Sales and Use Tax Agreement puts a rate or boundary change
//   (s. 304(A)(2), s. 305(A) and (C)). An authority's areas are confirmed by
//   the server asking it, and typed by nobody. CDTFA answers for California
//   alone, and an area keeps the source it was made from.
//
//   A PIECE TYPED SAYS WHO TYPED IT, and one an authority gave says nobody.
//
//   A PLACEMENT SAYS HOW ITS AREA WAS FOUND -- asked of the authority, or
//   chosen by a person -- and by whom, where somebody did it: a site asked
//   about as it was made, moved or asked again by hand was asked by whoever
//   did that, and one asked on the server's own refresh by nobody. Every
//   placement so far was asked, by somebody nobody wrote down. A site is
//   chosen into a typed area, and asked into an authority's.
//
// Typed areas and their pieces are people's work, so every change to them is
// kept, and so is one that goes, as the business's other settings are. When
// an area was last confirmed, and by whom, is not a change to it: the server
// confirms each of CDTFA's every day.
import { sql, type Kysely } from 'kysely';
import { recorded } from './20261117T1405Z_the_schema_as_it_stands/record.ts';

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('tax_area')
		/** Who typed it, where a person did. */
		.addColumn('typed_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		/** Who last confirmed it, where a person did: on confirmed_on. */
		.addColumn('confirmed_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.execute();
	await db.schema
		.alterTable('tax_area')
		.addCheckConstraint(
			'a_typed_area_says_who_typed_it',
			sql`(source = 'typed') = (typed_by is not null)`
		)
		.execute();
	await db.schema
		.alterTable('tax_area')
		.addCheckConstraint(
			'a_typed_area_says_who_confirmed_it',
			sql`(source = 'typed') = (confirmed_by is not null)`
		)
		.execute();
	await db.schema
		.alterTable('tax_area')
		.addCheckConstraint('cdtfa_answers_for_california', sql`source <> 'cdtfa' or state = 'CA'`)
		.execute();
	// Two typed areas of one name in a state could not be told apart where a
	// site's is chosen.
	await sql`create unique index tax_area_typed_name_once on tax_area (state, lower(name))
		where source = 'typed'`.execute(db);
	await sql`
		create function an_area_keeps_its_source() returns trigger
		language plpgsql as $function$
		BEGIN
		  RAISE EXCEPTION 'an area from % stays from %', OLD.source, OLD.source
		    USING ERRCODE = 'check_violation', CONSTRAINT = 'an_area_keeps_its_source';
		END $function$`.execute(db);
	await sql`
		create trigger an_area_keeps_its_source
		before update of source on tax_area
		for each row when (OLD.source IS DISTINCT FROM NEW.source)
		execute function an_area_keeps_its_source()`.execute(db);

	await db.schema
		.alterTable('tax_piece')
		/** Who typed it, where a person did. */
		.addColumn('typed_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.execute();
	await sql`
		create function a_piece_is_typed_as_its_area_is() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF (SELECT a.source = 'typed' FROM tax_area a WHERE a.id = NEW.area_id)
		     IS DISTINCT FROM (NEW.typed_by IS NOT NULL) THEN
		    RAISE EXCEPTION 'a typed area''s pieces say who typed them, and an authority''s say nobody'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'a_piece_is_typed_as_its_area_is';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create trigger a_piece_is_typed_as_its_area_is
		before insert or update of area_id, typed_by on tax_piece
		for each row execute function a_piece_is_typed_as_its_area_is()`.execute(db);

	/** How a site's area was found: asked of its authority, or chosen by a person. */
	await db.schema.createType('placement_way').asEnum(['asked', 'chosen']).execute();
	await db.schema
		.alterTable('site_placement')
		.addColumn('way', sql`placement_way`, (c) => c.notNull().defaultTo('asked'))
		/** Who placed it, where somebody did. */
		.addColumn('placed_by', 'uuid', (c) => c.references('user.id').onDelete('restrict'))
		.execute();
	await db.schema
		.alterTable('site_placement')
		.alterColumn('way', (c) => c.dropDefault())
		.execute();
	await db.schema
		.alterTable('site_placement')
		.addCheckConstraint(
			'a_chosen_placement_says_who_chose',
			sql`way <> 'chosen' or placed_by is not null`
		)
		.execute();
	await sql`
		create function a_placement_is_found_as_its_area_is() returns trigger
		language plpgsql as $function$
		BEGIN
		  IF (SELECT a.source = 'typed' FROM tax_area a WHERE a.id = NEW.area_id)
		     IS DISTINCT FROM (NEW.way = 'chosen') THEN
		    RAISE EXCEPTION 'a site is chosen into a typed area, and asked into an authority''s'
		      USING ERRCODE = 'check_violation', CONSTRAINT = 'a_placement_is_found_as_its_area_is';
		  END IF;
		  RETURN NEW;
		END $function$`.execute(db);
	await sql`
		create trigger a_placement_is_found_as_its_area_is
		before insert or update of area_id, way on site_placement
		for each row execute function a_placement_is_found_as_its_area_is()`.execute(db);

	await recorded(db, 'tax_area', { ignoring: ['confirmed_on', 'confirmed_by'], removals: true });
	await recorded(db, 'tax_piece', { removals: true });
}
