import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { personalToday } from './calendar.ts';
import { operatorRow } from './operator.ts';
import { knownDrives } from './trips.ts';
import { mileServices } from './trip-worth.ts';

/**
 * What a trip needs to be written down or changed: who drove, in what, where,
 * and each drive's miles as far as they are known -- the site's round trip
 * from the base, or the same drive as it was last driven -- before anyone types
 * them. `me` is whoever is recording it.
 */
export async function tripChoices(me: string) {
	const [people, vehicles, lastDriven, entities, sites, known, services, operator] =
		await Promise.all([
			db
				.select({ id: t.user.id, name: t.user.name })
				.from(t.user)
				.where(eq(t.user.active, true))
				.orderBy(asc(t.user.name)),
			db
				.select({
					id: t.vehicle.id,
					name: t.vehicle.name,
					owner_id: t.vehicle.ownerId,
					owner: t.user.name
				})
				.from(t.vehicle)
				.leftJoin(t.user, eq(t.user.id, t.vehicle.ownerId))
				.where(isNull(t.vehicle.retiredOn))
				.orderBy(asc(t.vehicle.name)),
			// What each driver last drove: a trip starts in it.
			db
				.selectDistinctOn([t.trip.drivenBy], {
					driver: t.trip.drivenBy,
					vehicle: t.trip.vehicleId
				})
				.from(t.trip)
				.where(isNotNull(t.trip.vehicleId))
				.orderBy(t.trip.drivenBy, desc(t.trip.travelledOn), desc(t.trip.createdAt)),
			db
				.select({ id: t.entity.id, name: t.entity.name })
				.from(t.entity)
				.where(eq(t.entity.active, true))
				.orderBy(asc(t.entity.name)),
			db
				.select({
					id: t.site.id,
					entity_id: t.site.entityId,
					label: t.site.label,
					street: t.site.street,
					city: t.site.city,
					postcode: t.site.postcode,
					round_trip_miles: t.site.roundTripMiles
				})
				.from(t.site)
				.innerJoin(t.entity, eq(t.entity.id, t.site.entityId))
				.where(and(eq(t.site.active, true), eq(t.entity.active, true)))
				.orderBy(asc(t.site.label)),
			knownDrives(),
			mileServices(),
			operatorRow()
		]);
	return {
		today: personalToday(),
		me,
		people,
		vehicles,
		last: Object.fromEntries(lastDriven.map((l) => [l.driver, l.vehicle])),
		entities,
		sites,
		known,
		services,
		base: operator?.address ?? null
	};
}

export type TripChoices = Awaited<ReturnType<typeof tripChoices>>;
