import { error } from '@sveltejs/kit';
import type { NumericString } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { vehicleTerms } from '#lib/server/vehicles.ts';
import type { PageServerLoad } from './$types';

/** One vehicle: what it is called, whose it is, what it has been driven, and what its miles pay. */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'No vehicle with that id.');
	const v = await db
		.selectFrom('vehicle')
		.leftJoin('user', 'user.id', 'vehicle.owner_id')
		.select((eb) => [
			'vehicle.id',
			'vehicle.name',
			'vehicle.owner_id',
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
				.$asScalar()
				.$notNull()
				.as('miles')
		])
		.where('vehicle.id', '=', params.id)
		.executeTakeFirst();
	if (!v) error(404, 'No vehicle with that id.');
	const terms = v.owner_id ? (await vehicleTerms([{ id: v.owner_id }]))[v.owner_id] : [];
	return { vehicle: v, terms };
};
