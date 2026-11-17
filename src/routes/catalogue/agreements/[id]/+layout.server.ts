import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { UUID } from '#lib/field-rules.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One agreement as a record -- a client's, or one of its sites' -- what it
 * charges and when it runs, what this period came to, and whether anything
 * has been charged under it: what its head and its menu say, whichever tab is
 * open. Each tab loads its own part.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such agreement');
	const today = businessToday();

	const agreement = await db
		.selectFrom('agreement as a')
		.innerJoin('entity as e', 'e.id', 'a.entity_id')
		.leftJoin('site as s', 's.id', 'a.site_id')
		.select((eb) => [
			'a.id',
			'a.entity_id',
			'e.name as client',
			'e.slug as client_slug',
			's.display as site',
			'a.price',
			'a.billing_interval',
			'a.billing_anchor_day',
			'a.starts_on',
			'a.ends_on',
			'a.final_period_proration',
			'a.contact_id',
			eb.fn
				.coalesce(eb('a.ends_on', '<', today), eb.lit(false))
				.$castTo<boolean>()
				.as('ended')
		])
		.where('a.id', '=', params.id)
		.executeTakeFirst();
	if (!agreement) error(404, 'no such agreement');

	const [charged, now] = await Promise.all([
		db
			.selectFrom('agreement_period')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('agreement_id', '=', agreement.id)
			.executeTakeFirstOrThrow(),
		// This period, if it has been charged: what it came to, or given freely.
		db
			.selectFrom('agreement_period')
			.select(['amount', 'given'])
			.where('agreement_id', '=', agreement.id)
			.where('period_start', '<=', today)
			.where('period_end', '>=', today)
			.executeTakeFirst()
	]);
	return { agreement, charged: charged.n, now: now ?? null, today };
};
