import { asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user, vehicle } from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import type { PageServerLoad } from './$types';

/**
 * The vehicles trips are driven in: whose each is, and the miles of the trips
 * driven in it this year, the retired after the rest.
 */
export const load: PageServerLoad = async () => {
	const yearStart = `${businessToday().slice(0, 4)}-01-01`;
	// Each vehicle, whose it is, and the miles of the trips driven in it:
	// this year's, and whether there are any at all, which decides whether it
	// can be removed or only retired.
	const vehicles = await db
		.select({
			id: vehicle.id,
			name: vehicle.name,
			owner: user.name,
			retired_on: vehicle.retiredOn,
			trips: sql<number>`(select count(*)::int from trip where trip.vehicle_id = ${vehicle.id})`,
			miles: sql<string>`(select coalesce(sum(l.miles), 0)::text from trip_leg l
				                     join trip tr on tr.id = l.trip_id
				                    where tr.vehicle_id = ${vehicle.id}
				                      and tr.travelled_on >= ${yearStart}::date)`
		})
		.from(vehicle)
		.leftJoin(user, eq(user.id, vehicle.ownerId))
		.orderBy(sql`${vehicle.retiredOn} is not null`, asc(vehicle.name));
	return { vehicles };
};
