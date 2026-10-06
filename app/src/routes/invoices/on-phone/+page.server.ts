import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import type { PageServerLoad } from './$types';

/**
 * A draft started on this phone, before it has arrived. The draft and its
 * lines are the phone's to know (#lib/queue), so the server gives only how
 * they are totalled -- by its rounding, to its places -- and when this copy
 * was made, for the screen to be kept for no signal.
 */
export const load: PageServerLoad = async () => {
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	return { rounding, places, as_of: new Date().toISOString() };
};
