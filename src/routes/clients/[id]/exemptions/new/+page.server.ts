import { db } from '#lib/server/db/index.ts';
import { findClient } from '#lib/server/find.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import { kindChoices } from '#lib/server/sale-kinds.ts';
import type { PageServerLoad } from './$types';

/**
 * A client's exemption, recorded from the certificate: the client, the
 * states the business collects in -- the first one the client has a site in
 * to start from -- and the kinds of sale it can cover.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { id } = await findClient(params.id);
	const [client, states, kinds, at] = await Promise.all([
		db.selectFrom('entity').select(['slug', 'name']).where('id', '=', id).executeTakeFirstOrThrow(),
		collecting(db),
		kindChoices(db),
		db
			.selectFrom('site')
			.select('region')
			.distinct()
			.where('entity_id', '=', id)
			.where('active', '=', true)
			.execute()
	]);
	const sitesIn = new Set(at.map((s) => s.region));
	return { client, states, kinds, start: states.find((s) => sitesIn.has(s)) ?? states[0] ?? '' };
};
