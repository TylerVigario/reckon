import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { vehicleTerms } from '#lib/server/vehicles.ts';
import type { PageServerLoad } from './$types';

/** Adding a vehicle: whose it could be, and what each one's miles would pay them. */
export const load: PageServerLoad = async ({ locals }) => {
	const people = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(eq(user.active, true))
		.orderBy(asc(user.name));
	return { people, terms: await vehicleTerms(people), me: locals.user!.id };
};
