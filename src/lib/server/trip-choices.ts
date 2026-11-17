import { db } from './db/index.ts';
import { personalToday } from './calendar.ts';
import { operatorRow } from './operator.ts';
import { knownDrives } from './trips.ts';
import { mileServices } from './trip-worth.ts';

/**
 * What a trip needs to be written down or changed: who drove, in what, where,
 * and each drive's miles as far as they are known -- the site's round trip
 * from the base, or the same drive as it was last driven -- before anyone types
 * them. `me` is whoever is recording it; with Field, the only one who can have
 * driven it (#lib/access).
 */
export async function tripChoices(me: string, field: boolean) {
	const [people, vehicles, lastDriven, entities, sites, known, services, operator] =
		await Promise.all([
			db
				.selectFrom('user')
				.select(['id', 'name'])
				.where('active', '=', true)
				.$if(field, (qb) => qb.where('id', '=', me))
				.orderBy('name')
				.execute(),
			db
				.selectFrom('vehicle')
				.leftJoin('user', 'user.id', 'vehicle.owner_id')
				.select(['vehicle.id', 'vehicle.name', 'vehicle.owner_id', 'user.name as owner'])
				.where('vehicle.retired_on', 'is', null)
				.orderBy('vehicle.name')
				.execute(),
			// What each driver last drove: a trip starts in it.
			db
				.selectFrom('trip')
				.distinctOn('driven_by')
				.select(['driven_by as driver', 'vehicle_id as vehicle'])
				.where('vehicle_id', 'is not', null)
				.orderBy('driven_by')
				.orderBy('travelled_on', 'desc')
				.orderBy('created_at', 'desc')
				.execute(),
			db
				.selectFrom('entity')
				.select(['id', 'name'])
				.where('active', '=', true)
				.orderBy('name')
				.execute(),
			db
				.selectFrom('site')
				.innerJoin('entity', 'entity.id', 'site.entity_id')
				.select([
					'site.id',
					'site.entity_id',
					'site.label',
					'site.street',
					'site.city',
					'site.postcode',
					'site.round_trip_miles'
				])
				.where('site.active', '=', true)
				.where('entity.active', '=', true)
				.orderBy('site.label')
				.execute(),
			knownDrives(),
			mileServices(),
			operatorRow()
		]);
	return {
		today: personalToday(),
		me,
		field,
		people,
		vehicles,
		last: Object.fromEntries(lastDriven.map((l) => [l.driver, l.vehicle])),
		entities,
		sites,
		known,
		services,
		base: operator?.address ?? null,
		// When this copy was made: a phone with no signal says how old it is.
		as_of: new Date().toISOString()
	};
}

export type TripChoices = Awaited<ReturnType<typeof tripChoices>>;
