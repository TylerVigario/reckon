import { lastFullMonth } from '#lib/server/periods.ts';
import { nonBillable } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

/** Last month's time given away: worked, not charged for, and what it was worth. */
export const load: PageServerLoad = async () => {
	const month = await lastFullMonth();
	return { month, given: await nonBillable(month) };
};
