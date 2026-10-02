import { today } from '#lib/server/db/index.ts';
import { clientsAndSites, theTeam, timedServices } from '#lib/server/choices.ts';
import { pricesToday } from '#lib/server/prices.ts';
import type { PageServerLoad } from './$types';

/**
 * What an entry needs to be written down: who pays, where, what was done.
 *
 * Prices come with the page for every service, client and crew it can offer,
 * so the rate shown changes the moment a choice is tapped -- and a wrong client
 * shows up as a wrong rate before anything is saved.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [day, people, entities, services, prices] = await Promise.all([
		today(),
		theTeam(),
		clientsAndSites(),
		timedServices(),
		pricesToday()
	]);
	return { today: day, me: locals.user!.id, people, entities, services, prices };
};
