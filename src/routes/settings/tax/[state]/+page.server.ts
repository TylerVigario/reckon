import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { typedAreas, typesAreasIn } from '#lib/server/typed-areas.ts';
import { isState, stateName } from '#lib/us-states.ts';
import type { PageServerLoad } from './$types';

/**
 * A state's areas, as the business has typed them in from the state's own
 * table (#lib/server/typed-areas): each one's rate today, and whether anyone
 * has confirmed it since this quarter began. Only where the business collects
 * and no authority answers for an address.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!isState(params.state) || !(await typesAreasIn(db, params.state)))
		error(404, `${stateName(params.state)}'s areas are not typed here.`);
	const today = businessToday();
	return { state: params.state, areas: await typedAreas(db, params.state, today) };
};
