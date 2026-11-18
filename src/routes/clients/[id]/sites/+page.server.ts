import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { db } from '#lib/server/db/index.ts';
import { findClient } from '#lib/server/find.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { rateIsStale } from '#lib/server/stale.ts';
import { areaRate } from '#lib/server/tax-areas.ts';
import type { PageServerLoad } from './$types';

/**
 * One client's places.
 *
 * A site gets the room to say what it is: where it is, what levies it and at what rate, how far it
 * is, and who to ask for when you get there.
 *
 * THE RATE IS THE SITE'S, NOT THE CLIENT'S, and it is CDTFA's rather than
 * anybody's here. One client can work in two counties, so there is no single
 * figure for the client -- this page is where that becomes obvious rather than
 * a footnote.
 */
export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);

	const client = await db
		.selectFrom('entity')
		.select(['id', 'slug', 'name'])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();

	const sites = await db
		.selectFrom('site as si')
		.innerJoin('tax_area as ta', 'ta.id', 'si.tax_area_id')
		.select((eb) => [
			'si.id',
			'si.slug',
			'si.display as label',
			eb
				.fn<string | null>('nullif', [
					eb.fn<string>('concat_ws', [
						eb.val(', '),
						'si.street',
						'si.city',
						'si.region',
						'si.postcode'
					]),
					eb.val('')
				])
				.as('address'),
			// Its area's rate today, and its shares (#lib/server/tax-areas).
			eb.cast<string>(areaRate(eb.ref('ta.id'), businessToday()), 'text').as('rate_pct'),
			eb
				.cast<string>(areaRate(eb.ref('ta.id'), businessToday(), 'state'), 'text')
				.as('state_rate_pct'),
			eb
				.cast<string>(areaRate(eb.ref('ta.id'), businessToday(), 'local'), 'text')
				.as('district_rate_pct'),
			'ta.name as jurisdiction',
			'ta.code as tax_area_code',
			rateIsStale(eb.ref('si.area_verified_on'), businessToday()).as('stale'),
			eb.cast<string | null>('si.round_trip_miles', 'text').as('miles'),
			'si.drive_minutes as minutes',
			eb.cast<string>('si.area_verified_on', 'text').as('verified_on'),
			jsonArrayFrom(
				eb
					.selectFrom('site_contact as sc')
					.innerJoin('contact as c', 'c.id', 'sc.contact_id')
					.select(['c.name', 'sc.is_primary'])
					.whereRef('sc.site_id', '=', 'si.id')
					.orderBy('sc.is_primary', 'desc')
					.orderBy('c.name')
			).as('people'),
			eb
				.selectFrom('entity_contact as ec')
				.innerJoin('contact as c', 'c.id', 'ec.contact_id')
				.select('c.name')
				.whereRef('ec.entity_id', '=', 'si.entity_id')
				.where('ec.is_primary', '=', true)
				.limit(1)
				.as('fallback'),
			'si.active'
		])
		.where('si.entity_id', '=', found.id)
		.orderBy('si.active', 'desc')
		.orderBy('si.display')
		.execute();

	return { client, sites };
};
