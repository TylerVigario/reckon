import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One receipt or invoice, as it was received: from whom, the day, its number,
 * who paid, the paper itself, and each item on it -- the lot it became, how
 * much, what it cost, and its share of the receipt's tax.
 *
 * Opened by the uuid it was made with, too -- where Receive goes once the
 * queue has sent it -- which answers with its own address.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such receipt');
	const receipt = await db
		.selectFrom('stock_receipt as sr')
		.leftJoin('user as payer', 'payer.id', 'sr.paid_by')
		.select((eb) => [
			'sr.id',
			'sr.received_on',
			'sr.supplier',
			'sr.reference',
			'payer.name as paid_by',
			'sr.tax_paid',
			eb('sr.receipt', 'is not', null).$castTo<boolean>().as('has_file'),
			'sr.receipt_type as file_type'
		])
		.where((eb) => eb.or([eb('sr.id', '=', params.id), eb('sr.client_uuid', '=', params.id)]))
		.executeTakeFirst();
	if (!receipt) error(404, 'no such receipt');
	if (receipt.id !== params.id) redirect(303, `/catalogue/receipts/${receipt.id}`);
	const items = await db
		.selectFrom('material_lot as ml')
		.innerJoin('material as m', 'm.id', 'ml.material_id')
		.innerJoin('unit as u', 'u.id', 'm.unit_id')
		.select((eb) => [
			'ml.id',
			'm.id as material_id',
			'm.name as material',
			eb.fn.coalesce('u.short', 'u.name').as('unit'),
			'ml.qty_received',
			'ml.qty_remaining',
			'ml.ex_tax_cost',
			'ml.tax_paid'
		])
		.where('ml.receipt_id', '=', receipt.id)
		.orderBy('ml.id')
		.execute();
	return { receipt, items };
};
