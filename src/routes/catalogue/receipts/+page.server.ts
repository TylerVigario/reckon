import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/**
 * Receipts: every receipt or invoice stock was received on, newest first --
 * from whom, its number, the day, who paid, how many items, and what it came
 * to with its tax.
 */
export const load: PageServerLoad = async () => {
	const receipts = await db
		.selectFrom('stock_receipt as sr')
		.leftJoin('user as payer', 'payer.id', 'sr.paid_by')
		.select((eb) => [
			'sr.id',
			'sr.received_on',
			'sr.supplier',
			'sr.reference',
			'payer.name as paid_by',
			eb
				.selectFrom('material_lot as l')
				.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
				.whereRef('l.receipt_id', '=', 'sr.id')
				.$asScalar()
				.$notNull()
				.as('items'),
			sql<string>`(${eb.ref('sr.tax_paid')} + coalesce(${eb
				.selectFrom('material_lot as l')
				.select((eb) => eb.fn.sum('l.ex_tax_cost').as('cost'))
				.whereRef('l.receipt_id', '=', 'sr.id')}, 0))::text`.as('total')
		])
		.orderBy('sr.received_on', 'desc')
		.orderBy('sr.created_at', 'desc')
		.execute();
	return { receipts };
};
