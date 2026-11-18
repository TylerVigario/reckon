import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { collectsIn, siteRate } from '#lib/server/tax-registrations.ts';
import { formFieldsOf, formTerms, materials } from '#lib/server/lines.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * Change a line added by hand: the Add a line form, filled in with the line as
 * it is (#lib/server/lines changeLine). A line on an invoice that has gone out,
 * or one a draft was built from, is shown and not changed -- as is one someone
 * with Field did not add (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.line)) error(404, 'no such line');
	const line = await db
		.selectFrom('invoice_line as il')
		.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
		.innerJoin('entity as e', 'e.id', 'i.entity_id')
		.select((eb) => [
			'il.id',
			'il.version',
			'il.kind',
			'il.material_id',
			'il.description',
			'il.qty',
			'il.site_id',
			'il.bought_from',
			'il.ex_tax_cost',
			'il.tax_paid',
			'il.paid_by',
			eb('il.receipt', 'is not', null).$castTo<boolean>().as('receipt'),
			'i.id as invoice_id',
			'i.client_uuid',
			'i.number',
			'i.status',
			'i.entity_id',
			'e.name as who',
			'il.created_by'
		])
		.where('il.id', '=', params.line)
		.where('il.invoice_id', '=', params.id)
		.executeTakeFirst();
	if (!line) error(404, 'no such line');
	const kind = line.kind;
	if (
		line.status !== 'draft' ||
		(kind !== 'material' && kind !== 'bought' && kind !== 'paid_for') ||
		(fieldOnly(locals) && line.created_by !== locals.user!.id)
	)
		redirect(303, `/invoices/${line.invoice_id}/lines/${line.id}`);

	const [sites, terms] = await Promise.all([
		db
			.selectFrom('site')
			.select((eb) => [
				'id',
				'display as label',
				// Whether the business collects in its state, and its area's rate
				// today where it does and the site has been placed
				// (#lib/server/tax-registrations).
				collectsIn(eb.ref('site.region')).as('collected'),
				siteRate(
					{ region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') },
					businessToday()
				).as('rate_pct')
			])
			.where('entity_id', '=', line.entity_id)
			.where('active', '=', true)
			.orderBy('display')
			.execute(),
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
