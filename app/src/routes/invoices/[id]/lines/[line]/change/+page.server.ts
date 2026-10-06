import { error, redirect } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { formFieldsOf, formTerms, materials } from '#lib/server/lines.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * Change a line added by hand: the Add a line form, filled in with the line as
 * it is (#lib/server/lines changeLine). A line on an invoice that has gone out,
 * or one a draft was built from, is shown and not changed.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such line');
	const il = t.invoiceLine;
	const [line] = await db
		.select({
			id: il.id,
			version: il.version,
			kind: il.kind,
			material_id: il.materialId,
			description: il.description,
			qty: il.qty,
			site_id: il.siteId,
			bought_from: il.boughtFrom,
			ex_tax_cost: il.exTaxCost,
			tax_paid: il.taxPaid,
			paid_by: il.paidBy,
			receipt: sql<boolean>`${il.receipt} is not null`,
			invoice_id: t.invoice.id,
			client_uuid: t.invoice.clientUuid,
			number: t.invoice.number,
			status: t.invoice.status,
			entity_id: t.invoice.entityId,
			who: t.entity.name
		})
		.from(il)
		.innerJoin(t.invoice, eq(t.invoice.id, il.invoiceId))
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.where(and(eq(il.id, params.line), eq(il.invoiceId, params.id)));
	if (!line) error(404, 'no such line');
	const kind = line.kind;
	if (line.status !== 'draft' || (kind !== 'material' && kind !== 'bought' && kind !== 'paid_for'))
		redirect(303, `/invoices/${line.invoice_id}/lines/${line.id}`);

	const [sites, terms] = await Promise.all([
		db
			.select({ id: t.site.id, label: t.site.display, rate_pct: t.site.taxRatePct })
			.from(t.site)
			.where(and(eq(t.site.entityId, line.entity_id), eq(t.site.active, true)))
			.orderBy(asc(t.site.display)),
		formTerms()
	]);
	// The line's own item, even with nothing left on the shelf: what it draws
	// can still go down.
	let stock = terms.stock;
	if (line.material_id && !stock.some((m) => m.id === line.material_id)) {
		const [m] = await materials([line.material_id]);
		const shelf = (await shelves([line.material_id])).get(line.material_id)!;
		if (m) stock = [...stock, { ...m, shelf }];
	}
	const text = (v: string | null) => v ?? '';
	return {
		...terms,
		stock,
		sites,
		draft: {
			id: line.invoice_id,
			client_uuid: line.client_uuid,
			number: line.number,
			who: line.who,
			status: line.status
		},
		editing: {
			id: line.id,
			// The save it began from: a phone's change says so, to be merged with
			// one made meanwhile.
			version: line.version,
			kind,
			receipt: line.receipt,
			drawn:
				kind === 'material'
					? { qty: line.qty, exTaxCost: text(line.ex_tax_cost), taxPaid: text(line.tax_paid) }
					: null,
			// As the form puts them: what a change is merged against.
			fields: formFieldsOf(line, terms.places)
		}
	};
};
