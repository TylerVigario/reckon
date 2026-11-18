import { businessToday } from '#lib/server/calendar.ts';
import { error } from '@sveltejs/kit';
import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { versionOf } from '#lib/server/concurrent.ts';
import { lastConfirmed, rateIsStale } from '#lib/server/stale.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import { areaPieces } from '#lib/server/tax-areas.ts';
import { collecting, collectsIn, siteRate } from '#lib/server/tax-registrations.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One site, as each of its tabs heads it (+layout): what it is called, what is
 * charged there and how much has been worked there, and how many people to ask
 * for. Details is where it is and how far; Contacts, who to ask for; Tax, the
 * area it is in and what is levied there.
 *
 * A site is the thing a jobsite rate, a mileage figure and a contact all hang
 * off, and every one of those is changed under it -- except the rate, which is
 * its area's and has no field: in California, CDTFA's, where the business
 * collects there (#lib/server/tax-registrations), and elsewhere the typed area
 * a person chose (#lib/server/typed-areas). It is the rate's one home, where
 * CDTFA is asked again or the area chosen. Someone with Field reads it, to
 * work at, and changes nothing (#lib/access).
 */
export const load: LayoutServerLoad = async ({ params }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);

	const site = await db
		.selectFrom('site as s')
		.innerJoin('entity as e', 'e.id', 's.entity_id')
		.leftJoin('tax_area as ta', 'ta.id', 's.tax_area_id')
		.select((eb) => [
			's.id',
			's.entity_id',
			versionOf('s').as('version'),
			'e.slug as client_slug',
			's.slug',
			'e.name as client',
			's.label',
			eb.ref('s.display').$notNull().as('display'),
			's.street',
			's.city',
			's.region',
			's.postcode',
			's.google_place_id',
			's.typed_round_trip_miles',
			's.typed_drive_minutes',
			's.google_round_trip_miles',
			's.google_drive_minutes',
			's.active',
			// Whether the business collects in its state; and its area, the
			// area's rate today where it does, and who levies it
			// (#lib/server/tax-areas).
			collectsIn(eb.ref('s.region')).as('collected'),
			siteRate({ region: eb.ref('s.region'), area: eb.ref('ta.id') }, businessToday()).as(
				'rate_pct'
			),
			areaPieces(eb.ref('ta.id').$castTo<string>(), businessToday()).as('pieces'),
			's.tax_area_id as area_id',
			'ta.name as area',
			'ta.code as area_code',
			's.area_verified_on as verified_on',
			eb.cast<string | null>('ta.confirmed_on', 'text').as('confirmed_on'),
			eb
				.and([
					collectsIn(eb.ref('s.region')),
					eb('ta.id', 'is not', null),
					rateIsStale(
						lastConfirmed(
							eb.ref('s.area_verified_on'),
							eb.ref('ta.confirmed_on'),
							eb.ref('ta.source')
						),
						businessToday()
					)
				])
				.$castTo<boolean>()
				.as('stale'),
			eb
				.cast<number>(
					eb
						.selectFrom('site_placement as k')
						.select((eb) => eb.fn.countAll().as('n'))
						.whereRef('k.site_id', '=', 's.id')
						.$asScalar(),
					'integer'
				)
				.as('asked')
		])
		.where('s.id', '=', found.id)
		.where('s.entity_id', '=', client.id)
		.executeTakeFirst();
	if (!site) error(404, 'no such site');

	const [people, worked, collects] = await Promise.all([
		db
			.selectFrom('site_contact')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('site_id', '=', found.id)
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('time_entry')
			.select((eb) => [
				eb.cast<string>(eb.fn.countAll(), 'text').as('entries'),
				sql<string>`coalesce(${eb.fn.sum('seconds')} / 3600.0, 0)::numeric(10,2)::text`.as('hours'),
				eb.cast<string | null>(eb.fn.max('worked_on'), 'text').as('last')
			])
			.where('site_id', '=', found.id)
			.executeTakeFirstOrThrow(),
		// Where the business collects tax: whether CDTFA is asked about the
		// place a site moves to.
		collecting(db)
	]);

	return { site, people: people.n, worked, collects };
};
