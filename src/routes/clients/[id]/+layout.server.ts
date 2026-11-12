import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import { findClient } from '#lib/server/find.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One client, as each of their tabs heads them (+layout): who they are,
 * whether they are still worked for, what they owe and on how many invoices,
 * and how many sites and contacts they have. Someone with Field reads where a
 * client is and whom to ask for, and nothing of what they owe (#lib/access).
 */
export const load: LayoutServerLoad = async ({ params, locals }) => {
	const { id } = await findClient(params.id);
	const field = fieldOnly(locals);
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	const e = t.entity;

	const [
		{
			rows: [client]
		},
		[sites],
		[contacts]
	] = await Promise.all([
		db.execute<{
			id: string;
			slug: string;
			name: string;
			active: boolean;
			owed: string;
			out: string;
		}>(sql`
			select ${e.id} as id, ${e.slug} as slug, ${e.name} as name, ${e.active} as active,
			       round(coalesce((select sum(b.owed) from ${owing} b
			                        where b.entity_id = ${e.id} and b.status = 'sent'), 0),
			             ${places}::int)::text as owed,
			       (select count(*) from ${owing} b
			         where b.entity_id = ${e.id} and b.status = 'sent' and b.owed > 0)::text as out
			  from ${e}
			 where ${e.id} = ${id}`),
		db
			.select({ n: count() })
			.from(t.site)
			.where(and(eq(t.site.entityId, id), eq(t.site.active, true))),
		db.select({ n: count() }).from(t.entityContact).where(eq(t.entityContact.entityId, id))
	]);

	return {
		client: field ? { ...client, owed: null, out: null } : client,
		counts: { sites: sites.n, contacts: contacts.n }
	};
};
