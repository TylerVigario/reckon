import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { findClient } from '#lib/server/find.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * A client's Contacts: their people, each opening their own page, where their
 * details are changed, with the sites each is asked for at; and which of them
 * the invoices go to. Someone with Field reads them, to know whom to ask for,
 * and not whose invoices go to whom (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { id } = await findClient(params.id);
	const c = t.contact;
	const ec = t.entityContact;
	const { rows: contacts } = await db.execute<{
		id: string;
		name: string;
		email: string | null;
		phone: string | null;
		bills: boolean;
		sites: string[];
	}>(sql`
		select ${c.id} as id, ${c.name} as name, ${c.email} as email, ${c.phone} as phone,
		       ${ec.isPrimary} as bills,
		       coalesce((select array_agg(${t.site.label} order by ${t.site.label})
		                   from ${t.siteContact}
		                   join ${t.site} on ${t.site.id} = ${t.siteContact.siteId}
		                  where ${t.siteContact.contactId} = ${c.id}
		                    and ${t.siteContact.entityId} = ${ec.entityId}), '{}') as sites
		  from ${ec}
		  join ${c} on ${c.id} = ${ec.contactId}
		 where ${ec.entityId} = ${id}
		 order by ${c.name}`);
	return {
		contacts: fieldOnly(locals) ? contacts.map((x) => ({ ...x, bills: false })) : contacts
	};
};
