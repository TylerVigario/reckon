import { db } from '#lib/server/db/index.ts';
import { vehicleTerms } from '#lib/server/vehicles.ts';
import type { PageServerLoad } from './$types';

/** Adding a vehicle: whose it could be, and what each one's miles would pay them. */
export const load: PageServerLoad = async ({ locals }) => {
	const people = await db
		.selectFrom('user')
		.select(['id', 'name'])
		.where('active', '=', true)
		.orderBy('name')
		.execute();
	return { people, terms: await vehicleTerms(people), me: locals.user!.id };
};
