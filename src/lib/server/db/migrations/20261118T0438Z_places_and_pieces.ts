// A RATE BELONGS TO A PLACE, NOT TO A SITE (18 November 2026). Every state's
// sales tax is the same shape: pieces, by who levies them -- federal, state,
// local -- added together, a state being that shape with some pieces empty. A
// rate is a place's: the combination of jurisdictions at an address, what
// CDTFA's tax area code names. A site only says which place it is in.
//
// So a place is a row of its own, a tax_area, with its pieces, and a site
// points at it. The official sources are built the same way: the Streamlined
// Sales Tax Agreement (s. 305) keeps a rate database by jurisdiction apart from
// a boundary database that maps an address to its jurisdictions, and CDTFA's
// rate API turns an address into a tax area code apart from its rate layer,
// which turns the code into the rate and its shares.
//
// Each site's CDTFA answer becomes its area's: one area per tax area code,
// named as CDTFA names it, with the state's share and the area's district
// taxes as its two pieces, as of the day CDTFA was last asked about a site in
// it. Where two sites in one area were answered differently -- one asked again
// since -- the newer answer is the area's.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	/** Who levies a piece of a tax. Federal is empty in the United States. */
	await db.schema.createType('tax_level').asEnum(['federal', 'state', 'local']).execute();
	/**
	 * Where an area's pieces come from: an authority that answers for an
	 * address. CDTFA, California's, is the first.
	 */
	await db.schema.createType('tax_area_source').asEnum(['cdtfa']).execute();

	/**
	 * A TAX AREA: one place with one combination of jurisdictions, and so one
	 * rate. Named as its authority names it -- FRESNO, UNINCORPORATED
	 * AREA-FRESNO -- and never by a postal city, which is the same "Fresno" for
	 * both. Its rate is its pieces' (tax_piece). confirmed_on is the day its
	 * source last confirmed them.
	 */
	await db.schema
		.createTable('tax_area')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		/** Its state, as the post writes it: CA. */
		.addColumn('state', 'text', (c) => c.notNull().check(sql`state ~ '^[A-Z]{2}$'`))
		/** Its authority's code for it, where it has one: CDTFA's tax area code. */
		.addColumn('code', 'text')
		.addColumn('name', 'text', (c) => c.notNull().check(sql`btrim(name) <> ''`))
		.addColumn('source', sql`tax_area_source`, (c) => c.notNull())
		.addColumn('confirmed_on', 'date', (c) => c.notNull())
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.execute();
	// An authority's code names one area in its state.
	await db.schema
		.createIndex('tax_area_code_names_one')
		.on('tax_area')
		.columns(['state', 'code'])
		.unique()
		.where('code', 'is not', null)
		.execute();

	/**
	 * A PIECE OF AN AREA'S RATE: who levies it, and how much. An area's pieces
	 * come in sets, each dated from the day it took effect where its source says
	 * so, and otherwise from the day reckon learnt it; the set in force on a day
	 * is the newest dated on or before it, so a figure from last quarter stays
	 * explainable. An area's rate is its set's pieces added together.
	 */
	await db.schema
		.createTable('tax_piece')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('area_id', 'uuid', (c) => c.notNull().references('tax_area.id').onDelete('cascade'))
		.addColumn('level', sql`tax_level`, (c) => c.notNull())
		/** Who levies it, as its authority names them: CALIFORNIA, FRESNO. */
		.addColumn('jurisdiction', 'text', (c) => c.notNull().check(sql`btrim(jurisdiction) <> ''`))
		/** Its authority's code for that jurisdiction, where there is one. */
		.addColumn('code', 'text')
		.addColumn('rate_pct', sql`numeric(7, 4)`, (c) => c.notNull().check(sql`rate_pct >= 0`))
		.addColumn('effective_from', 'date', (c) => c.notNull())
		// A jurisdiction levies once in a set.
		.addUniqueConstraint('tax_piece_once_in_a_set', [
			'area_id',
			'effective_from',
			'level',
			'jurisdiction'
		])
		.execute();

	// Each site's CDTFA answer, as an area: the newest answer for each code.
	await sql`
		insert into tax_area (state, code, name, source, confirmed_on)
		select distinct on (tax_area_code)
		       'CA', tax_area_code, tax_jurisdiction, 'cdtfa'::tax_area_source, area_verified_on
		  from site
		 order by tax_area_code, area_verified_on desc, id`.execute(db);
	await sql`
		insert into tax_piece (area_id, level, jurisdiction, code, rate_pct, effective_from)
		select a.id, 'state'::tax_level, 'CALIFORNIA', null, s.state_rate_pct, a.confirmed_on
		  from tax_area a
		  join lateral (
		    select state_rate_pct, district_rate_pct from site
		     where tax_area_code = a.code
		     order by area_verified_on desc, id limit 1
		  ) s on true
		union all
		select a.id, 'local'::tax_level, a.name, a.code, s.district_rate_pct, a.confirmed_on
		  from tax_area a
		  join lateral (
		    select district_rate_pct from site
		     where tax_area_code = a.code
		     order by area_verified_on desc, id limit 1
		  ) s on true
		 where s.district_rate_pct > 0`.execute(db);

	await db.schema
		.alterTable('site')
		.addColumn('tax_area_id', 'uuid', (c) => c.references('tax_area.id').onDelete('restrict'))
		.execute();
	await sql`
		update site set tax_area_id = a.id
		  from tax_area a
		 where a.state = 'CA' and a.code = site.tax_area_code`.execute(db);
	await db.schema
		.alterTable('site')
		.alterColumn('tax_area_id', (c) => c.setNotNull())
		.execute();
	// The rate, its shares and its area are the area's now; the constraints
	// on them go with them.
	await db.schema
		.alterTable('site')
		.dropColumn('tax_area_code')
		.dropColumn('tax_jurisdiction')
		.dropColumn('tax_rate_pct')
		.dropColumn('state_rate_pct')
		.dropColumn('district_rate_pct')
		.execute();
	await db.schema.createIndex('site_by_tax_area').on('site').column('tax_area_id').execute();
}
