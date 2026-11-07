import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { findClient } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

/** Adding a contact to a client: the client, and who its invoices go to now. */
export const load: PageServerLoad = async ({ params }) => {
	const { id } = await findClient(params.id);
	const [client] = await db
		.select({ slug: t.entity.slug, name: t.entity.name })
		.from(t.entity)
		.where(eq(t.entity.id, id));
	const [bills] = await db
		.select({ name: t.contact.name })
		.from(t.entityContact)
		.innerJoin(t.contact, eq(t.contact.id, t.entityContact.contactId))
		.where(and(eq(t.entityContact.entityId, id), eq(t.entityContact.isPrimary, true)));
	return { client, bills: bills?.name ?? null };
};
