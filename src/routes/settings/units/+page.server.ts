import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/**
 * What things are counted in: the operator's own list, and how many materials
 * each counts, so a unit nothing uses can be let go.
 */
export const load: PageServerLoad = async () => {
	const units = await db
		.selectFrom('unit as u')
		.select((eb) => [
			'u.id',
			'u.name',
			'u.short',
			'u.places',
			eb
				.selectFrom('material as m')
				.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
				.whereRef('m.unit_id', '=', 'u.id')
				.$asScalar()
				.$notNull()
				.as('materials')
		])
		.orderBy('u.name')
		.execute();
	return { units };
};
