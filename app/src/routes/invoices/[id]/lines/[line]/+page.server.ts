import { error } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One line, opened from its draft: what it was bought from, paid to or drawn
 * from stock as, its receipt, what it bills, and its history -- as the mock's
 * line screen has them. A line added by hand can be changed or taken off here
 * while its draft is a draft.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such line');
	const il = t.invoiceLine;
	const payer = alias(t.user, 'payer');
	const src = alias(t.invoice, 'src');
	const [line] = await db
		.select({
			id: il.id,
			kind: il.kind,
			description: il.description,
			qty: il.qty,
			unit: il.unit,
			unit_price: il.unitPrice,
			amount: il.amount,
			taxable: il.taxable,
			tax_rate_pct: il.taxRatePct,
			ex_tax_cost: il.exTaxCost,
			tax_paid: il.taxPaid,
			bought_from: il.boughtFrom,
			paid_by: payer.name,
			where: t.site.display,
			item: t.material.name,
			receipt_type: il.receiptType,
			moved_from: src.number,
			invoice_id: t.invoice.id,
			number: t.invoice.number,
			status: t.invoice.status,
			who: t.entity.name
		})
		.from(il)
		.innerJoin(t.invoice, eq(t.invoice.id, il.invoiceId))
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.leftJoin(t.site, eq(t.site.id, il.siteId))
		.leftJoin(payer, eq(payer.id, il.paidBy))
		.leftJoin(t.material, eq(t.material.id, il.materialId))
		.leftJoin(src, eq(src.id, il.movedFromInvoiceId))
		.where(and(eq(il.id, params.line), eq(il.invoiceId, params.id)));
	if (!line) error(404, 'no such line');

	const h = t.recordHistory;
	const [added, saves, [op]] = await Promise.all([
		db
			.select({ who: t.user.name, at: h.changedAt })
			.from(h)
			.leftJoin(t.user, eq(t.user.id, h.changedBy))
			.where(and(eq(h.tableName, 'invoice_line'), eq(h.rowId, line.id), eq(h.field, '(added)')))
			.orderBy(asc(h.changedAt))
			.limit(1),
		// Each save that changed it is one moment.
		db
			.select({ n: sql<number>`count(distinct ${h.changedAt})::int` })
			.from(h)
			.where(
				and(eq(h.tableName, 'invoice_line'), eq(h.rowId, line.id), sql`${h.field} not like '(%'`)
			),
		db.select({ claims: t.operator.claimsTaxPaidPurchasesResold }).from(t.operator)
	]);
	return {
		line,
		added: added[0] ?? null,
		changes: saves[0]?.n ?? 0,
		claims: op?.claims ?? false
	};
};
