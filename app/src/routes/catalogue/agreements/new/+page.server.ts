import { today } from '#lib/server/db/index.ts';
import { clientsAndSites } from '#lib/server/choices.ts';
import type { PageServerLoad } from './$types';

/** Every client, with its sites, so choosing one shows what an agreement can cover. */
export const load: PageServerLoad = async ({ url }) => {
	const [clients, day] = await Promise.all([clientsAndSites(), today()]);
	// ?client=harbor-light-dental starts it on that client, for the way in from a client.
	const asked = url.searchParams.get('client');
	return { clients, today: day, chosen: clients.find((c) => c.slug === asked)?.id ?? null };
};
