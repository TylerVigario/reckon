import { error } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * One contact: who they are, and the clients and sites they act for.
 *
 * This is where a contact's details live; a client and a site name them and
 * link here. Someone with Field reads them, to call or ask for somebody on a
 * job, and not whose invoices go to them (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!UUID.test(params.id)) error(404, 'no such contact');
	const c = t.contact;
	const ec = t.entityContact;
	const e = t.entity;
	const sc = t.siteContact;
	const s = t.site;

	const [person] = await db
		.select({ id: c.id, name: c.name, email: c.email, phone: c.phone, note: c.note })
		.from(c)
		.where(eq(c.id, params.id));
	if (!person) error(404, 'no such contact');

	const { rows: clients } = await db.execute<{
		slug: string;
		name: string;
		bills: boolean;
		sites: string[];
	}>(sql`
		select ${e.slug} as slug, ${e.name} as name, ${ec.isPrimary} as bills,
		       coalesce((select array_agg(${s.label} order by ${s.label})
		                   from ${sc} join ${s} on ${s.id} = ${sc.siteId}
		                  where ${sc.contactId} = ${ec.contactId}
		                    and ${sc.entityId} = ${ec.entityId}), '{}') as sites
		  from ${ec}
		  join ${e} on ${e.id} = ${ec.entityId}
		 where ${ec.contactId} = ${person.id}
		 order by ${e.name}`);

	const field = fieldOnly(locals);
	return {
		person,
		clients: field ? clients.map((x) => ({ ...x, bills: false })) : clients
	};
};
