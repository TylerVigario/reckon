import { desc, eq } from 'drizzle-orm';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
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
	const payer = alias(t.user, 'payer');
	const lots = await db
		.select({
			id: t.materialLot.id,
			receipt_id: t.materialLot.receiptId,
			adjustment_id: t.materialLot.adjustmentId,
			received_on: t.materialLot.receivedOn,
			supplier: t.stockReceipt.supplier,
			reference: t.stockReceipt.reference,
			qty_received: t.materialLot.qtyReceived,
			qty_remaining: t.materialLot.qtyRemaining,
			ex_tax_cost: t.materialLot.exTaxCost,
			tax_paid: t.materialLot.taxPaid,
			paid_by: payer.name
		})
		.from(t.materialLot)
		.leftJoin(t.stockReceipt, eq(t.stockReceipt.id, t.materialLot.receiptId))
		.leftJoin(payer, eq(payer.id, t.stockReceipt.paidBy))
		.where(eq(t.materialLot.materialId, params.id))
		.orderBy(desc(t.materialLot.receivedOn), desc(t.materialLot.id));
	if (!isOfflineCopy(url)) return { lots };
	return { lots: lots.map((l) => ({ ...l, ex_tax_cost: null, tax_paid: null, paid_by: null })) };
};
