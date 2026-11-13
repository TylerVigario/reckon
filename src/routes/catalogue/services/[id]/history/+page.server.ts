import { prices, rules } from '#lib/server/catalogue.ts';
import type { PageServerLoad } from './$types';

/**
 * Everything a service has been priced at and paid by, including what no longer
 * is: its History tab. Kept off Prices and Pay so they say what is true now;
 * here because a line billed in June was billed at June's price, and this is
 * where that price is still written down.
 */
export const load: PageServerLoad = async ({ params }) => {
	const [priced, paying] = await Promise.all([prices(params.id), rules(params.id)]);
	return { prices: priced, rules: paying };
};
