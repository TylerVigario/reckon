import { eq, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { user, vehicle } from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { vehicleTerms } from '#lib/server/vehicles.ts';
import type { PageServerLoad } from './$types';

/** One vehicle: what it is called, whose it is, what it has been driven, and what its miles pay. */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'No vehicle with that id.');
	const [v] = await db
		.select({
			id: vehicle.id,
			name: vehicle.name,
			owner_id: vehicle.ownerId,
			owner: user.name,
			retired_on: vehicle.retiredOn,
			trips: sql<number>`(select count(*)::int from trip where trip.vehicle_id = ${vehicle.id})`,
			miles: sql<string>`(select coalesce(sum(l.miles), 0)::text from trip_leg l
			                     join trip tr on tr.id = l.trip_id
			                    where tr.vehicle_id = ${vehicle.id})`
		})
		.from(vehicle)
		.leftJoin(user, eq(user.id, vehicle.ownerId))
		.where(eq(vehicle.id, params.id));
	if (!v) error(404, 'No vehicle with that id.');
	const terms = v.owner_id ? (await vehicleTerms([{ id: v.owner_id }]))[v.owner_id] : [];
	return { vehicle: v, terms };
};
