import { error } from '@sveltejs/kit';
import { businessToday } from '#lib/server/calendar.ts';
import { filingIn } from '#lib/server/sales-tax.ts';
import { isState } from '#lib/us-states.ts';
import type { PageServerLoad } from './$types';

/**
 * A payment to a state, recorded from what its agency gave back: the state's
 * periods, the one under way among them for a prepayment, starting from the
 * latest whose return leaves something owing, or else the one under way.
 */
export const load: PageServerLoad = async ({ params }) => {
	const filing = isState(params.state) ? await filingIn(params.state, { current: true }) : null;
	if (!filing) error(404, 'No tax to pay there.');
	const start = filing.periods.find((p) => Number(p.owing) > 0) ?? filing.periods[0];
	return { ...filing, today: businessToday(), start: start ?? null };
};
