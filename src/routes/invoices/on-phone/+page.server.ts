import { moneyPlaces } from '#lib/server/business.ts';
import { TAX_ROUNDING } from '#lib/server/tax-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * A draft started on this phone, before it has arrived. The draft and its
 * lines are the phone's to know (#lib/queue), so the server gives only how
 * they are totalled -- by its rounding, to its places -- and when this copy
 * was made, for the screen to be kept for no signal.
 */
export const load: PageServerLoad = async () => {
	const places = await moneyPlaces();
	return { rounding: TAX_ROUNDING, places, as_of: new Date().toISOString() };
};
