import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
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
	const e = t.entity;
	const {
		rows: [client]
	} = await db.execute<{
		id: string;
		slug: string;
		version: string;
		terms: number | null;
		default_terms: number;
		payment_method: string | null;
		tax_exempt: boolean;
		certificate: string | null;
	}>(sql`
		select ${e.id} as id, ${e.slug} as slug, ${e}.xmin::text as version,
		       ${e.termsDays} as terms,
		       (select ${t.operator.defaultTermsDays} from ${t.operator}) as default_terms,
		       ${e.paymentMethod} as payment_method, ${e.taxExempt} as tax_exempt,
		       ${e.exemptionCertificate} as certificate
		  from ${e}
		 where ${e.id} = ${id}`);
	if (!client) error(404, 'no such client');
	return { details: client };
};
