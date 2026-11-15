import { lastFullMonth, thisMonth } from '#lib/server/periods.ts';
import { retainerMeter } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

/**
 * The month under way, or with ?month=last the last one closed. A retainer is
 * charged in advance, so the month under way already has its charge; what
 * builds is the usage.
 */
export const load: PageServerLoad = async ({ url }) => {
	const last = url.searchParams.get('month') === 'last';
	const [now, closed] = await Promise.all([thisMonth(), lastFullMonth()]);
	const period = last ? closed : now;
	return {
		last,
		labels: { now: now.label, closed: closed.label },
		month: { period, ...(await retainerMeter(period)) }
	};
};
