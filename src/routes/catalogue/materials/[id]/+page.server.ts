import { isOfflineCopy } from '#lib/offline-copy.ts';
import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/**
 * A material's Stock tab: every lot of it, newest first -- received on a
 * receipt, from whom and who paid, or found -- how much came and how much is
 * left, and what it cost and its share of the tax.
 *
 * Kept for no signal with quantities alone (#lib/offline-copy): what each lot
 * cost, and who paid for it, need a connection.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const lots = await db
		.selectFrom('material_lot as ml')
		.leftJoin('stock_receipt as sr', 'sr.id', 'ml.receipt_id')
		.leftJoin('user as payer', 'payer.id', 'sr.paid_by')
		.select([
			'ml.id',
			'ml.receipt_id',
			'ml.adjustment_id',
			'ml.received_on',
			'sr.supplier',
			'sr.reference',
			'ml.qty_received',
			'ml.qty_remaining',
			'ml.ex_tax_cost',
			'ml.tax_paid',
			'payer.name as paid_by'
		])
		.where('ml.material_id', '=', params.id)
		.orderBy('ml.received_on', 'desc')
		.orderBy('ml.id', 'desc')
		.execute();
	if (!isOfflineCopy(url)) return { lots };
	return { lots: lots.map((l) => ({ ...l, ex_tax_cost: null, tax_paid: null, paid_by: null })) };
};
