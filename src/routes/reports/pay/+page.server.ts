import { lastFullMonth } from '#lib/server/periods.ts';
import { payOwed } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const month = await lastFullMonth();
	return { month, ...(await payOwed(month)) };
};
