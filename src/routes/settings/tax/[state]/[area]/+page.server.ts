import { error } from '@sveltejs/kit';
import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { areaPieces, areaRate, kindRates } from '#lib/server/tax-areas.ts';
import { quarterBegan } from '#lib/server/stale.ts';
import { findTypedArea, typesAreasIn } from '#lib/server/typed-areas.ts';
import { kindChoices, taxesByState } from '#lib/server/sale-kinds.ts';
import { isState, stateName } from '#lib/us-states.ts';
import { nextQuarter } from '#lib/quarters.ts';
import type { PageServerLoad } from './$types';

/**
 * One typed area: what the state calls it and who typed it, its rate today
 * and whether anyone has confirmed it this quarter, every rate it has had or
 * will have from a day and who typed each, the sites in it, and the kinds of
 * sale a piece can fall on alone. Its rate today is on every kind the state
 * taxes, and a kind it taxes alone says its own.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!isState(params.state) || !(await typesAreasIn(db, params.state)))
		error(404, `${stateName(params.state)}'s areas are not typed here.`);
	const found = await findTypedArea(db, params.state, params.area);
	if (!found) error(404, 'No such area of that state is typed here.');
	const today = businessToday();

	const [area, sets, sites, kinds, taxes] = await Promise.all([
		db
			.selectFrom('tax_area as a')
			.innerJoin('user as t', 't.id', 'a.typed_by')
			.innerJoin('user as c', 'c.id', 'a.confirmed_by')
			.select((eb) => [
				'a.id',
				'a.name',
				'a.code',
				't.name as typed_by',
				sql<string>`(${eb.ref('a.created_at')})::date::text`.as('typed_on'),
				eb.cast<string>('a.confirmed_on', 'text').as('confirmed_on'),
				'c.name as confirmed_by',
				sql<boolean>`${eb.ref('a.confirmed_on')} < ${quarterBegan(today)}`.as('stale'),
				areaRate(eb.ref('a.id'), today).as('rate_pct'),
				areaPieces(eb.ref('a.id'), today).as('pieces'),
				eb
					.exists(
						eb.selectFrom('site_placement as k').select('k.id').whereRef('k.area_id', '=', 'a.id')
					)
					.$castTo<boolean>()
					.as('placed')
			])
			.where('a.id', '=', found.id)
			.executeTakeFirstOrThrow(),
		// Each rate from its day, newest first, its pieces in the order a
		// line keeps them.
		db
			.selectFrom('tax_piece as p')
			.leftJoin('user as u', 'u.id', 'p.typed_by')
			.select((eb) => [
				eb.cast<string>('p.effective_from', 'text').as('from'),
				'p.level',
				'p.jurisdiction',
				'p.code',
				eb.cast<string>('p.rate_pct', 'text').as('rate'),
				'p.sale_kind_id as kind',
				'u.name as typed_by'
			])
			.where('p.area_id', '=', found.id)
			.orderBy('p.effective_from', 'desc')
			.orderBy('p.level')
			.orderBy(sql`p.sale_kind_id is not null`)
			.orderBy('p.jurisdiction')
			.execute(),
		db
			.selectFrom('site as s')
			.innerJoin('entity as e', 'e.id', 's.entity_id')
			.select(['s.id', 's.display', 's.slug', 'e.slug as client_slug', 'e.name as client'])
			.where('s.tax_area_id', '=', found.id)
			.where('s.active', '=', true)
			.orderBy('e.name')
			.orderBy('s.display')
			.execute(),
		kindChoices(db),
		taxesByState(db)
	]);
	const names = Object.fromEntries(kinds.map((k) => [k.id, k.name]));

	const rates = [...new Set(sets.map((p) => p.from))].map((from) => {
		const pieces = sets.filter((p) => p.from === from);
		return { from, pieces, typed_by: pieces[0].typed_by };
	});
	// The rate in force today is the newest on or before it; one before that
	// has been replaced, and one after is coming.
	const inForce = rates.find((r) => r.from <= today)?.from ?? null;
	const inForceToday = rates.filter((r) => r.from <= today).length;
	return {
		state: params.state,
		area: {
			...area,
			// Its pieces on every kind, which its rate today is.
			every: area.pieces.filter((p) => !p.kind),
			byKind: kindRates(area.pieces, taxes[params.state] ?? [], names)
		},
		rates: rates.map((r) => ({
			...r,
			when:
				r.from > today
					? ('coming' as const)
					: r.from === inForce
						? ('now' as const)
						: ('was' as const),
			// Not the only rate in force today: every site in it would be left with none.
			removable: r.from > today || inForceToday > 1
		})),
		sites,
		kinds,
		today,
		next: nextQuarter(today)
	};
};
