import { error } from '@sveltejs/kit';
import { businessToday } from '#lib/server/calendar.ts';
import { filingIn } from '#lib/server/sales-tax.ts';
import { isState } from '#lib/us-states.ts';
import type { PageServerLoad } from './$types';

/**
 * A return filed with a state, recorded from what its agency gave back: the
 * state's latest periods, the latest of those with no return filed to start
 * from, and what was collected for each.
 */
export const load: PageServerLoad = async ({ params }) => {
	const filing = isState(params.state) ? await filingIn(params.state, { current: false }) : null;
	if (!filing) error(404, 'No tax to file for there.');
	const start = filing.periods.find((p) => p.filedOn === null) ?? filing.periods[0];
	return { ...filing, today: businessToday(), start: start ?? null };
};
