import { and, asc, desc, eq, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * Who to ask for at a site, the one who answers first heading them; and, for
 * someone who can add one, the client's other people, offered before a new
 * one is typed.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);

	const [people, elsewhere] = await Promise.all([
		db
			.select({
				id: t.contact.id,
				name: t.contact.name,
				email: t.contact.email,
				phone: t.contact.phone,
				is_primary: t.siteContact.isPrimary
			})
			.from(t.siteContact)
			.innerJoin(t.contact, eq(t.contact.id, t.siteContact.contactId))
			.where(eq(t.siteContact.siteId, found.id))
			.orderBy(desc(t.siteContact.isPrimary), asc(t.contact.name)),
		// The client's other people, offered before a new one is typed: creating a
		// second Dana Whitfield because nobody looked first is what a name match
		// cannot undo afterwards.
		fieldOnly(locals)
			? []
			: db
					.select({ id: t.contact.id, name: t.contact.name })
					.from(t.entityContact)
					.innerJoin(t.contact, eq(t.contact.id, t.entityContact.contactId))
					.where(
						and(
							eq(t.entityContact.entityId, client.id),
							notExists(
								db
									.select({ x: sql`1` })
									.from(t.siteContact)
									.where(
										and(
											eq(t.siteContact.siteId, found.id),
											eq(t.siteContact.contactId, t.contact.id)
										)
									)
							)
						)
					)
					.orderBy(asc(t.contact.name))
	]);

	return { contacts: people, elsewhere };
};
