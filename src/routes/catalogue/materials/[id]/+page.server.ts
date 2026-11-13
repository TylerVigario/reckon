import { error } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { materialFigures } from '#lib/server/stock.ts';
import type { PageServerLoad } from './$types';

/**
 * One material, and every lot of it received: when, from whom, how much and
 * how much is left, what it cost and its share of the receipt's tax, who paid,
 * and the receipt it came on.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such material');
	const [found] = await db
		.select({
			id: t.material.id,
			name: t.material.name,
			sku: t.material.sku,
			brand: t.material.brand,
			unit: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`
		})
		.from(t.material)
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.where(eq(t.material.id, params.id));
	if (!found) error(404, 'no such material');

	const payer = alias(t.user, 'payer');
	const lots = await db
		.select({
			id: t.materialLot.id,
			receipt_id: t.materialLot.receiptId,
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
		.innerJoin(t.stockReceipt, eq(t.stockReceipt.id, t.materialLot.receiptId))
		.leftJoin(payer, eq(payer.id, t.stockReceipt.paidBy))
		.where(and(eq(t.materialLot.materialId, found.id)))
		.orderBy(desc(t.materialLot.receivedOn), desc(t.materialLot.id));
	const figures = await materialFigures([found.id]);
	return { material: { ...found, ...figures.of.get(found.id)! }, lots };
};
