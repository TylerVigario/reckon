import { error, redirect } from '@sveltejs/kit';
import { asc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
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
	const payer = alias(t.user, 'payer');
	const [receipt] = await db
		.select({
			id: t.stockReceipt.id,
			received_on: t.stockReceipt.receivedOn,
			supplier: t.stockReceipt.supplier,
			reference: t.stockReceipt.reference,
			paid_by: payer.name,
			tax_paid: t.stockReceipt.taxPaid,
			has_file: sql<boolean>`${t.stockReceipt.receipt} is not null`,
			file_type: t.stockReceipt.receiptType
		})
		.from(t.stockReceipt)
		.leftJoin(payer, eq(payer.id, t.stockReceipt.paidBy))
		.where(or(eq(t.stockReceipt.id, params.id), eq(t.stockReceipt.clientUuid, params.id)));
	if (!receipt) error(404, 'no such receipt');
	if (receipt.id !== params.id) redirect(303, `/catalogue/receipts/${receipt.id}`);
	const items = await db
		.select({
			id: t.materialLot.id,
			material_id: t.material.id,
			material: t.material.name,
			unit: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`,
			qty_received: t.materialLot.qtyReceived,
			qty_remaining: t.materialLot.qtyRemaining,
			ex_tax_cost: t.materialLot.exTaxCost,
			tax_paid: t.materialLot.taxPaid
		})
		.from(t.materialLot)
		.innerJoin(t.material, eq(t.material.id, t.materialLot.materialId))
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.where(eq(t.materialLot.receiptId, receipt.id))
		.orderBy(asc(t.materialLot.id));
	return { receipt, items };
};
