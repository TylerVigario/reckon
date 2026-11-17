import { db } from '#lib/server/db/index.ts';
import { businessDay } from '#lib/server/calendar.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

/**
 * What CDTFA has said of a site: the latest answers it has given, and which
 * was its first, which has nothing before it to have moved from. Each is dated
 * by the business's day, as Last asked is (#lib/server/calendar).
 */
export const load: PageServerLoad = async ({ params }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);
	const checks = await db
		.selectFrom('site_tax_check as k')
		.select((eb) => [
			'k.id',
			eb.cast<string>(businessDay(eb.ref('k.checked_at')), 'text').as('on'),
			'k.rate_pct',
			'k.tax_jurisdiction as jurisdiction',
			'k.changed',
			'k.note',
			eb(
				eb.fn.agg<number>('row_number').over((ob) => ob.orderBy('k.checked_at').orderBy('k.id')),
				'=',
				eb.lit(1)
			)
				.$castTo<boolean>()
				.as('first')
		])
		.where('k.site_id', '=', found.id)
		.orderBy('k.checked_at', 'desc')
		.limit(8)
		.execute();
	return { checks };
};
