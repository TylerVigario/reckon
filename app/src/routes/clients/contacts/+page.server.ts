import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/** People, who cross entities and locations both. */
export const load: PageServerLoad = async () => {
	const c = t.contact;
	const ec = t.entityContact;
	const e = t.entity;
	const sc = t.siteContact;
	const si = t.site;

	const { rows: contacts } = await db.execute<{
		id: string;
		name: string;
		email: string | null;
		phone: string | null;
		note: string | null;
		clients: string[];
		sites: string[];
		primary_for: string[];
	}>(sql`
		select ${c.id} as id, ${c.name} as name, ${c.email} as email, ${c.phone} as phone,
		       ${c.note} as note,
		       -- coalesce, not just array_remove: array_agg over no rows is NULL,
		       -- and a filtered aggregate matching nothing is exactly that case --
		       -- a contact who is nobody's primary would hand the page a null to
		       -- call .includes() on.
		       coalesce(array_remove(array_agg(distinct ${e.name}), null), '{}') as clients,
		       coalesce(array_remove(array_agg(distinct ${si.display}), null), '{}') as sites,
		       coalesce(array_remove(array_agg(distinct ${e.name})
		                             filter (where ${ec.isPrimary}), null), '{}') as primary_for
		  from ${c}
		  left join ${ec} on ${ec.contactId} = ${c.id}
		  left join ${e} on ${e.id} = ${ec.entityId}
		  left join ${sc} on ${sc.contactId} = ${c.id}
		  left join ${si} on ${si.id} = ${sc.siteId}
		 group by ${c.id}
		 order by ${c.name}`);

	return { contacts };
};
