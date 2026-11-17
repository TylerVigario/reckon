import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/** An agreement's Terms tab: its terms, and whom at the client it could be agreed with. */
export const load: PageServerLoad = async ({ parent }) => {
	const { agreement } = await parent();
	return {
		contacts: await db
			.selectFrom('entity_contact as ec')
			.innerJoin('contact as c', 'c.id', 'ec.contact_id')
			.select(['c.id', 'c.name'])
			.where('ec.entity_id', '=', agreement.entity_id)
			.orderBy('c.name')
			.execute()
	};
};
