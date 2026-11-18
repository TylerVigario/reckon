// A SITE KEEPS WHERE IT WAS PLACED, AND AN AREA ITS RATES (18 November 2026).
// Each question put to CDTFA about a site was kept whole, rates and shares and
// all (site_tax_check), beside the areas that now keep the same rates. Two
// records of one answer. What an answer says of the site is which area its
// address is in, and when that was asked; what it says of the area is its
// rate, which the area keeps in its dated sets (tax_piece).
//
// So a site keeps its placements: when it was placed, in which area, and
// whether that moved it from the area it was in before. Every answer kept so
// far becomes one, and its rate the area's set from the day it was given,
// where the area had none of its own from that day. An answer that named no
// area places nothing, as it placed nothing when it was given.
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
	// An area for every code an answer named, as CDTFA named it then.
	await sql`
		insert into tax_area (state, code, name, source, confirmed_on)
		select distinct on (k.tax_area_code)
		       'CA', k.tax_area_code, k.tax_jurisdiction, 'cdtfa'::tax_area_source, k.checked_at::date
		  from site_tax_check k
		 where k.tax_area_code is not null and k.tax_jurisdiction is not null
		   and not exists (select 1 from tax_area a where a.state = 'CA' and a.code = k.tax_area_code)
		 order by k.tax_area_code, k.checked_at desc`.execute(db);

	// An answer's rate, as its area's set from that day, where it differs from
	// the answer before and the area has none from then: the state's share
	// and, where there are any, the districts'.
	await sql`
		with daily as (
		  select distinct on (a.id, k.checked_at::date)
		         a.id as area_id, k.checked_at::date as day, a.name,
		         a.code, k.state_rate_pct, k.district_rate_pct
		    from site_tax_check k
		    join tax_area a on a.state = 'CA' and a.code = k.tax_area_code
		   where k.state_rate_pct is not null and k.district_rate_pct is not null
		   order by a.id, k.checked_at::date, k.checked_at desc
		), answered as (
		  select * from (
		    select d.*, lag((d.state_rate_pct, d.district_rate_pct))
		                  over (partition by d.area_id order by d.day) as before
		      from daily d
		  ) x
		   where x.before is distinct from (x.state_rate_pct, x.district_rate_pct)
		     and not exists (select 1 from tax_piece p
		                      where p.area_id = x.area_id and p.effective_from = x.day)
		)
		insert into tax_piece (area_id, level, jurisdiction, code, rate_pct, effective_from)
		select area_id, 'state'::tax_level, 'CALIFORNIA', null, state_rate_pct, day from answered
		union all
		select area_id, 'local'::tax_level, name, code, district_rate_pct, day from answered
		 where district_rate_pct > 0`.execute(db);

	// A set the same as the one before it changed nothing, and goes.
	await sql`
		with sets as (
		  select area_id, effective_from,
		         string_agg(level || ' ' || jurisdiction || ' ' || rate_pct::text, ', '
		                    order by level, jurisdiction) as said
		    from tax_piece group by area_id, effective_from
		), repeated as (
		  select area_id, effective_from from (
		    select s.*, lag(said) over (partition by area_id order by effective_from) as before
		      from sets s
		  ) x where x.said = x.before
		)
		delete from tax_piece p using repeated r
		 where p.area_id = r.area_id and p.effective_from = r.effective_from`.execute(db);

	/**
	 * Each time a site was placed in a tax area: by CDTFA, asked about its
	 * address when it was made, when it moved, when asked again by hand, and on
	 * a refresh. moved is true where that put it in another area than the one
	 * before, its first placement among them.
	 */
	await db.schema
		.createTable('site_placement')
		.addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
		.addColumn('site_id', 'uuid', (c) => c.notNull().references('site.id').onDelete('cascade'))
		.addColumn('placed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('area_id', 'uuid', (c) => c.notNull().references('tax_area.id').onDelete('restrict'))
		.addColumn('moved', 'boolean', (c) => c.notNull())
		.addColumn('note', 'text')
		.execute();
	await db.schema
		.createIndex('site_placement_by_site')
		.on('site_placement')
		.column('site_id')
		.expression(sql`placed_at desc`)
		.execute();

	await sql`
		insert into site_placement (id, site_id, placed_at, area_id, moved, note)
		select k.id, k.site_id, k.checked_at, a.id,
		       a.id is distinct from lag(a.id) over (partition by k.site_id order by k.checked_at, k.id),
		       k.note
		  from site_tax_check k
		  join tax_area a on a.state = 'CA' and a.code = k.tax_area_code`.execute(db);

	await db.schema.dropTable('site_tax_check').execute();
}
