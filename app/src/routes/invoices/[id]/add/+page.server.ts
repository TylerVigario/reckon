import { error, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { materials } from '#lib/server/lines.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * Add a line: goods drawn from stock, goods bought for the job, or a cost paid
 * on the client's behalf (#lib/server/lines).
 *
 * Everything the page needs to say what a line will bill as it is typed, with
 * no signal: the client's sites and their rates, who might have paid, the
 * business's terms, and what is on the shelf. The line itself is written on
 * the phone and sent by the queue (#lib/queue), so there is no form action.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such invoice');
	const [draft] = await db
		.select({
			id: t.invoice.id,
			number: t.invoice.number,
			status: t.invoice.status,
			entity_id: t.invoice.entityId,
			who: t.entity.name
		})
		.from(t.invoice)
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.where(eq(t.invoice.id, params.id));
	if (!draft) error(404, 'no such invoice');
	if (draft.status !== 'draft') redirect(303, `/invoices/${draft.id}`);
	const [sites, people, [op], places, all] = await Promise.all([
		db
			.select({ id: t.site.id, label: t.site.display, rate_pct: t.site.taxRatePct })
			.from(t.site)
			.where(and(eq(t.site.entityId, draft.entity_id), eq(t.site.active, true)))
			.orderBy(asc(t.site.display)),
		db
			.select({ id: t.user.id, name: t.user.name })
			.from(t.user)
			.where(eq(t.user.active, true))
			.orderBy(asc(t.user.name)),
		db
			.select({
				markup: t.operator.purchaseMarkupPct,
				rules: t.operator.taxRuleSet,
				costing: t.operator.stockCosting
			})
			.from(t.operator),
		moneyPlaces(),
		materials()
	]);
	// What is on the shelf, so the page can say what a draw costs as it is typed.
	const onShelf = await shelves(all.map((m) => m.id));
	return {
		draft,
		sites,
		people,
		markup: op?.markup ?? '0',
		rules: op?.rules ?? 'none',
		costing: op?.costing ?? 'average',
		places,
		stock: all
			.map((m) => ({ ...m, shelf: onShelf.get(m.id)! }))
			.filter((m) => m.shelf.lots.length > 0),
		// When this copy was made: shown when it is opened with no signal.
		as_of: new Date().toISOString()
	};
};
