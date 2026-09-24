import { lastFullMonth, thisMonth } from '$lib/server/periods';
import { retainerMeter } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

/**
 * The month under way and the last one closed. A retainer is charged in advance,
 * so the month under way already has its charge; what builds is the usage.
 */
export const load: PageServerLoad = async () => {
	const [now, month] = await Promise.all([thisMonth(), lastFullMonth()]);
	const [current, closed] = await Promise.all([retainerMeter(now), retainerMeter(month)]);
	return {
		months: [
			{ period: now, ...current },
			{ period: month, ...closed }
		]
	};
};
