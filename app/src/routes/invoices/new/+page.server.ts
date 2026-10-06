import { clientsAndSites } from '#lib/server/choices.ts';
import type { PageServerLoad } from './$types';

/**
 * A new draft for a client. It is started on the phone and sent by the queue
 * (#lib/queue), so it can be started with no signal; it takes the operator's
 * next number when it reaches the server (#lib/server/drafts) -- at once, with
 * a signal.
 */
export const load: PageServerLoad = async ({ url }) => {
	const clients = await clientsAndSites();
	const asked = url.searchParams.get('client');
	return {
		clients: clients.map((c) => ({ id: c.id, name: c.name })),
		client: asked && clients.some((c) => c.id === asked) ? asked : null,
		// When this copy was made: shown when it is opened with no signal.
		as_of: new Date().toISOString()
	};
};
