import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { VERSION } from '#lib/server/concurrent.ts';
import { findClient } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

/**
 * A client's Details: their address in the app, how long they have to pay and
 * how they usually do, and whether they are taxed. Full's alone (#lib/access).
 *
 * No tax rate: a rate is a site's, not the client's, and shown on the site.
 * A client is not a place -- two clients can work at one address, and one
 * client can work in two districts.
 *
 * The version is the row's (#lib/server/concurrent), so a change somebody
 * saved since this was read is not written over unseen.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { id } = await findClient(params.id);
	const client = await db
		.selectFrom('entity as e')
		.select((eb) => [
			'e.id',
			'e.slug',
			// The entity's xmin: the operator's is inside its own subquery.
			VERSION.as('version'),
			'e.terms_days as terms',
			eb.selectFrom('operator').select('default_terms_days').$asScalar().as('default_terms'),
			'e.payment_method',
			'e.tax_exempt',
			'e.exemption_certificate as certificate'
		])
		.where('e.id', '=', id)
		.executeTakeFirst();
	if (!client) error(404, 'no such client');
	return { details: client };
};
