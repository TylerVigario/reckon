import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { findClient } from '#lib/server/find.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import { typedAreas } from '#lib/server/typed-areas.ts';
import { typesAreas } from '#lib/us-states.ts';
import type { PageServerLoad } from './$types';

/**
 * The client a site is made for, and where the business collects tax: in
 * California, where it does, CDTFA prices the site as it is made; in a state
 * whose areas are typed, a person may choose its area as it is made, from
 * that state's (#lib/server/typed-areas).
 */
export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);
	const client = await db
		.selectFrom('entity')
		.select(['id', 'slug', 'name'])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();
	const collects = await collecting(db);
	const today = businessToday();
	const areas = Object.fromEntries(
		await Promise.all(
			collects.filter(typesAreas).map(async (state) => [
				state,
				(await typedAreas(db, state, today)).map(({ id, name, rate_pct }) => ({
					id,
					name,
					rate_pct
				}))
			])
		)
	) as Record<string, { id: string; name: string; rate_pct: string }[]>;
	return { client, collects, areas };
};
