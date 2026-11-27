import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { fiscalYear } from '#lib/server/periods.ts';
import { collectedIn, scheduleA } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

/**
 * The year's Schedule A, and what was collected for California on it. Until the
 * month the filing year ends in is set, there is no year to report, and the
 * tab says where it is set.
 */
export const load: PageServerLoad = async ({ parent }) => {
	// California's return, so none where the business does not collect there.
	if (!(await parent()).scheduleA) redirect(307, resolve('/reports/pay'));
	const fy = await fiscalYear();
	if (!fy) return { fy: null };
	const [a, collected] = await Promise.all([scheduleA(fy), collectedIn(fy, 'CA')]);
	return { fy, ...a, collected };
};
