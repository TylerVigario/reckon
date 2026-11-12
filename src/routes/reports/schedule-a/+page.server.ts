import { fiscalYear } from '#lib/server/periods.ts';
import { scheduleA, taxObligation } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

/**
 * The year's Schedule A, and what is owed on it. Until the month the filing
 * year ends in is set, there is no year to report, and the tab says where it
 * is set.
 */
export const load: PageServerLoad = async () => {
	const fy = await fiscalYear();
	if (!fy) return { fy: null };
	const [a, owed] = await Promise.all([scheduleA(fy), taxObligation(fy)]);
	return { fy, ...a, owed };
};
