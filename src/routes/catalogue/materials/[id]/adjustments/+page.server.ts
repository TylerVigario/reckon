import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/**
 * A material's Adjustments tab: every time its stock was put right, by hand
 * or by a count, newest first -- taken off or put on, how much, why, by whom,
 * and what it moved was worth.
 */
export const load: PageServerLoad = async ({ params }) => ({
	adjustments: await db
		.selectFrom('stock_adjustment as a')
		.innerJoin('user as u', 'u.id', 'a.created_by')
		.select([
			'a.id',
			'a.made_on',
			'a.way',
			'a.qty',
			'a.reason',
			'a.note',
			'a.ex_tax_cost',
			'a.tax_paid',
			'a.count_id',
			'u.name as by'
		])
		.where('a.material_id', '=', params.id)
		.orderBy('a.made_on', 'desc')
		.orderBy('a.created_at', 'desc')
		.execute()
});
