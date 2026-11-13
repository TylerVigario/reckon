import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/** An agreement's Terms tab: its terms, and whom at the client it could be agreed with. */
export const load: PageServerLoad = async ({ parent }) => {
	const { agreement } = await parent();
	return {
		contacts: await db
			.select({ id: t.contact.id, name: t.contact.name })
			.from(t.entityContact)
			.innerJoin(t.contact, eq(t.contact.id, t.entityContact.contactId))
			.where(eq(t.entityContact.entityId, agreement.entity_id))
			.orderBy(asc(t.contact.name))
	};
};
