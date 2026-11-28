import { retainerMeter } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

/**
 * Each retainer's period under way, or with ?period=last the one just closed:
 * its own, a week, a month, a quarter or a year from its own anchor
 * (#lib/agreement-periods). A retainer is charged in advance, so the period
 * under way already has its charge; what builds is the usage.
 */
export const load: PageServerLoad = async ({ url }) => {
	const last = url.searchParams.get('period') === 'last';
	return { last, ...(await retainerMeter(last ? 'last' : 'now')) };
};
