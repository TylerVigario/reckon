import { businessToday } from '#lib/server/calendar.ts';
import { clientsAndSites } from '#lib/server/choices.ts';
import type { PageServerLoad } from './$types';

/** Every client, with its sites, so choosing one shows what an agreement can cover. */
export const load: PageServerLoad = async ({ url }) => {
	const day = businessToday();
	const clients = await clientsAndSites();
	// ?client=harbor-light-dental starts it on that client, for the way in from a client.
	const asked = url.searchParams.get('client');
	return { clients, today: day, chosen: clients.find((c) => c.slug === asked)?.id ?? null };
};
