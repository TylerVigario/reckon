import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { service, user, vehicle } from '#lib/server/db/schema/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { prices } from '#lib/server/catalogue.ts';
import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const yearStart = `${businessToday().slice(0, 4)}-01-01`;
	const [operator, mileage, priced, vehicles] = await Promise.all([
		operatorRow(),
		db
			.select({ id: service.id, name: service.name })
			.from(service)
			.where(and(eq(service.unit, 'mile'), eq(service.active, true)))
			.orderBy(asc(service.name)),
		prices(),
		// Each vehicle, whose it is, and the miles of the trips driven in it:
		// this year's, and whether there are any at all, which decides whether it
		// can be removed or only retired.
		db
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
			.orderBy(sql`${vehicle.retiredOn} is not null`, asc(vehicle.name))
	]);
	// The mileage rate is a service price, dated, like every other price: the
	// every-client price of each service charged per mile, in force or about to
	// be. What it used to be is that service's history, and a client's own
	// mileage price is on the services screen with the rest of its prices.
	const everyClient = priced.filter(
		(p) => p.client === null && mileage.some((m) => m.id === p.service_id)
	);
	const rates = everyClient
		.filter((p) => p.state !== 'superseded')
		.map((p) => ({ ...p, service: mileage.find((m) => m.id === p.service_id)!.name }));
	const history = mileage
		.map((m) => ({
			...m,
			earlier: everyClient.filter((p) => p.service_id === m.id && p.state === 'superseded').length
		}))
		.filter((m) => m.earlier > 0);
	return { operator, rates, history, vehicles };
};
