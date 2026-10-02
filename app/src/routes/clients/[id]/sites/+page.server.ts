import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { findClient } from '#lib/server/find.ts';
import { rateIsStale } from '#lib/server/stale.ts';
import type { PageServerLoad } from './$types';

/**
 * One client's places.
 *
 * A site gets the room to say what it is: where it is, what levies it and at what rate, how far it
 * is, and who to ask for when you get there.
 *
 * THE RATE IS THE SITE'S, NOT THE CLIENT'S, and it is CDTFA's rather than
 * anybody's here. One client can work in two counties, so there is no single
 * figure for the client -- this page is where that becomes obvious rather than
 * a footnote.
 */
export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);

	const [client] = await db
		.select({ id: t.entity.id, slug: t.entity.slug, name: t.entity.name })
		.from(t.entity)
		.where(eq(t.entity.id, found.id));

	const si = t.site;
	const sc = t.siteContact;
	const ec = t.entityContact;
	const c = t.contact;

	const { rows: sites } = await db.execute<{
		id: string;
		slug: string;
		label: string;
		address: string | null;
		rate_pct: string;
		state_rate_pct: string;
		district_rate_pct: string;
		jurisdiction: string;
		tax_area_code: string;
		stale: boolean;
		miles: string | null;
		minutes: number | null;
		verified_on: string | null;
		people: { name: string; is_primary: boolean }[];
		fallback: string | null;
		active: boolean;
	}>(sql`
		select ${si.id} as id, ${si.slug} as slug, ${si.display} as label,
		       nullif(concat_ws(', ', ${si.street}, ${si.city}, ${si.region}, ${si.postcode}), '') as address,
		       ${si.taxRatePct}::text as rate_pct,
		       ${si.stateRatePct}::text as state_rate_pct,
		       ${si.districtRatePct}::text as district_rate_pct,
		       ${si.taxJurisdiction} as jurisdiction,
		       ${si.taxAreaCode} as tax_area_code,
		       ${rateIsStale(si.areaVerifiedOn)} as stale,
		       ${si.roundTripMiles}::text as miles,
		       ${si.driveMinutes} as minutes,
		       ${si.areaVerifiedOn}::text as verified_on,
		       coalesce(people.list, '[]'::jsonb) as people,
		       fallback.name as fallback,
		       ${si.active} as active
		  from ${si}
		  left join lateral (
		         select jsonb_agg(jsonb_build_object('name', ${c.name}, 'is_primary', ${sc.isPrimary})
		                          order by ${sc.isPrimary} desc, ${c.name}) as list
		           from ${sc} join ${c} on ${c.id} = ${sc.contactId}
		          where ${sc.siteId} = ${si.id}) people on true
		  left join lateral (
		         select ${c.name} as name from ${ec} join ${c} on ${c.id} = ${ec.contactId}
		          where ${ec.entityId} = ${si.entityId} and ${ec.isPrimary} limit 1) fallback on true
		 where ${si.entityId} = ${found.id}
		 order by ${si.active} desc, ${si.display}`);

	return { client, sites };
};
