import { lastFullMonth } from '$lib/server/periods';
import { remoteMeter } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const month = await lastFullMonth();
	return { month, ...(await remoteMeter(month)) };
};
