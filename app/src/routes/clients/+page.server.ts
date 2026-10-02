import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { rateIsStale } from '#lib/server/stale.ts';
import type { PageServerLoad } from './$types';

/**
 * Entities: the three things, and none owns another.
 *
 * A client is a business; a site is a place; a contact is a person. Two clients
 * can work at one address and each names it their own way, so the count beside
 * a client is that client's sites, not the address book's.
 */
export const load: PageServerLoad = async () => {
	const e = t.entity;
	const si = t.site;
	const ec = t.entityContact;
	const c = t.contact;

	const { rows: clients } = await db.execute<{
		id: string;
		slug: string;
		name: string;
		active: boolean;
		contact: string | null;
		sites: string;
		site_labels: string | null;
		owed: string;
	}>(sql`
		with owing as (
			select entity_id, sum(owed) as owed from ${balances} b
			 where status = 'sent' group by entity_id
		)
		select ${e.id} as id, ${e.slug} as slug, ${e.name} as name, ${e.active} as active,
		       (select ${c.name} from ${ec} join ${c} on ${c.id} = ${ec.contactId}
		         where ${ec.entityId} = ${e.id} and ${ec.isPrimary} limit 1) as contact,
		       count(${si.id})::text as sites,
		       string_agg(${si.display}, ' · ' order by ${si.display}) as site_labels,
		       coalesce(o.owed, 0)::numeric(12,2)::text as owed
		  from ${e}
		  left join ${si} on ${si.entityId} = ${e.id} and ${si.active}
		  left join owing o on o.entity_id = ${e.id}
		 group by ${e.id}, o.owed
		 order by ${e.active} desc, ${e.name}`);

	// Every site has a rate; what varies is how long ago CDTFA was asked.
	const [[contacts], [unpriced]] = await Promise.all([
		db.select({ n: count() }).from(t.contact),
		db
			.select({ n: count() })
			.from(t.site)
			.where(and(eq(t.site.active, true), rateIsStale(t.site.areaVerifiedOn)))
	]);

	return {
		clients,
		counts: { contacts: String(contacts.n), unpriced: String(unpriced.n) }
	};
};
