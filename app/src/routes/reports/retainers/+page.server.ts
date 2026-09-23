import { lastFullMonth } from '$lib/server/periods';
import { retainerMeter } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const month = await lastFullMonth();
	return { month, ...(await retainerMeter(month)) };
};
