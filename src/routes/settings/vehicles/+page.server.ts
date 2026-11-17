import type { NumericString } from 'kysely';
import { db } from '#lib/server/db/index.ts';
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
		.selectFrom('vehicle')
		.leftJoin('user', 'user.id', 'vehicle.owner_id')
		.select((eb) => [
			'vehicle.id',
			'vehicle.name',
			'user.name as owner',
			'vehicle.retired_on',
			eb
				.selectFrom('trip')
				.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
				.whereRef('trip.vehicle_id', '=', 'vehicle.id')
				.$asScalar()
				.$notNull()
				.as('trips'),
			eb
				.selectFrom('trip_leg as l')
				.innerJoin('trip as tr', 'tr.id', 'l.trip_id')
				.select((eb) =>
					eb
						.cast<string>(eb.fn.coalesce(eb.fn.sum<NumericString>('l.miles'), eb.lit(0)), 'text')
						.as('miles')
				)
				.whereRef('tr.vehicle_id', '=', 'vehicle.id')
				.where('tr.travelled_on', '>=', yearStart)
				.$asScalar()
				.$notNull()
				.as('miles')
		])
		.orderBy((eb) => eb('vehicle.retired_on', 'is not', null))
		.orderBy('vehicle.name')
		.execute();
	return { vehicles };
};
