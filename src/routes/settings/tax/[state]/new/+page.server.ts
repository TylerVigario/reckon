import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { typesAreasIn } from '#lib/server/typed-areas.ts';
import { isState, stateName } from '#lib/us-states.ts';
import { quarterOf } from '#lib/quarters.ts';
import type { PageServerLoad } from './$types';

/**
 * A new area of a state, typed in from its own table: the state's own share
 * as another of its areas has it today, where one does, to start from, and
 * this quarter's first day, which is when a rate in force today most likely
 * took effect.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!isState(params.state) || !(await typesAreasIn(db, params.state)))
		error(404, `${stateName(params.state)}'s areas are not typed here.`);
	const today = businessToday();
	const stateShare = await db
		.selectFrom('tax_piece as p')
		.innerJoin('tax_area as a', 'a.id', 'p.area_id')
		.select(['p.jurisdiction', (eb) => eb.cast<string>('p.rate_pct', 'text').as('rate_pct')])
		.where('a.state', '=', params.state)
		.where('a.source', '=', 'typed')
		.where('p.level', '=', 'state')
		.where('p.effective_from', '<=', today)
		.orderBy('p.effective_from', 'desc')
		.limit(1)
		.executeTakeFirst();
	return { state: params.state, stateShare: stateShare ?? null, from: quarterOf(today), today };
};
