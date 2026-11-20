import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { answersFor } from '#lib/server/sale-kinds.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import { typedAreas, typesAreasIn } from '#lib/server/typed-areas.ts';
import { isState, stateName } from '#lib/us-states.ts';
import type { PageServerLoad } from './$types';

/**
 * A state the business collects in: whether it taxes each kind of sale, as
 * the business has it (#lib/server/sale-kinds), and who said so and when.
 * Where no authority answers for an address, its areas too, as the business
 * has typed them in from the state's own table (#lib/server/typed-areas):
 * each one's rate today, and whether anyone has confirmed it since this
 * quarter began.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!isState(params.state) || !(await collecting(db)).includes(params.state))
		error(404, `The business does not collect tax in ${stateName(params.state)}.`);
	const today = businessToday();
	const typed = await typesAreasIn(db, params.state);
	return {
		state: params.state,
		answers: await answersFor(db, { state: params.state }),
		typed,
		areas: typed ? await typedAreas(db, params.state, today) : []
	};
};
