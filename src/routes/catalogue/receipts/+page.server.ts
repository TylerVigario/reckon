import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * Receipts: every receipt or invoice stock was received on, newest first --
 * from whom, its number, the day, who paid, how many items, and what it came
 * to with its tax.
 */
export const load: PageServerLoad = async () => {
	const payer = alias(t.user, 'payer');
	const receipts = await db
		.select({
			id: t.stockReceipt.id,
			received_on: t.stockReceipt.receivedOn,
			supplier: t.stockReceipt.supplier,
			reference: t.stockReceipt.reference,
			paid_by: payer.name,
			items: sql<number>`(select count(*) from ${t.materialLot} l where l.receipt_id = ${t.stockReceipt.id})::int`,
			total: sql<string>`(${t.stockReceipt.taxPaid} + coalesce((select sum(l.ex_tax_cost) from ${t.materialLot} l where l.receipt_id = ${t.stockReceipt.id}), 0))::text`
		})
		.from(t.stockReceipt)
		.leftJoin(payer, eq(payer.id, t.stockReceipt.paidBy))
		.orderBy(desc(t.stockReceipt.receivedOn), desc(t.stockReceipt.createdAt));
	return { receipts };
};
