import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { RECEIPT_TYPES } from '#lib/server/db/schema/catalogue.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { shelves } from '#lib/server/stock.ts';
import { fromStock, passedOn } from '#lib/passed-on.ts';
import { readFromStock, readPassedOn } from '#lib/line-fields.ts';
import { drawFrom } from '#lib/stock-draw.ts';
import { quantity } from '#lib/format.ts';
import { UUID } from '#lib/field-rules.ts';
import type { Actions, PageServerLoad } from './$types';

/** What the phone sends is shrunk to well under this; the column holds no more. */
const MAX_RECEIPT = 2 * 1024 * 1024;

/** The draft, its client's sites and the business's terms for what is passed on. */
async function draftOf(id: string) {
	if (!UUID.test(id)) error(404, 'no such invoice');
	const [found] = await db
		.select({
			id: t.invoice.id,
			number: t.invoice.number,
			status: t.invoice.status,
			entity_id: t.invoice.entityId,
			who: t.entity.name
		})
		.from(t.invoice)
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.where(eq(t.invoice.id, id));
	if (!found) error(404, 'no such invoice');
	return found;
}

/**
 * Materials, or one: what each is counted in, what it sells at -- the price
 * listed today, or its markup on what it cost -- and whether it is goods the
 * business taxes.
 */
function materials(ids?: string[]) {
	const listed = sql<string | null>`(
		select ${t.materialPrice.price}::text from ${t.materialPrice}
		 where ${t.materialPrice.materialId} = ${t.material.id}
		   and ${t.materialPrice.effectiveFrom} <= ${businessToday()}::date
		 order by ${t.materialPrice.effectiveFrom} desc limit 1)`;
	return db
		.select({
			id: t.material.id,
			name: t.material.name,
			sku: t.material.sku,
			unit: t.unit.name,
			// How its unit is written beside a figure: "ft", or the name.
			short: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`,
			places: t.unit.places,
			markup: sql<string>`coalesce(${t.material.markupPct}, (select ${t.operator.defaultMarkupPct} from ${t.operator}), 0)::text`,
			listed,
			taxable: t.material.taxable
		})
		.from(t.material)
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.where(ids ? inArray(t.material.id, ids) : eq(t.material.active, true))
		.orderBy(asc(t.material.name));
}

/**
 * A line added to a draft by hand: goods drawn from stock (#lib/stock-draw),
 * goods bought for the job, or a cost paid on the client's behalf, each with who
 * paid and its receipt (#lib/passed-on).
 *
 * A file is not a field, so this is a form action, as receiving stock is.
 */
export const load: PageServerLoad = async ({ params }) => {
	const draft = await draftOf(params.id);
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
			.filter((m) => m.shelf.lots.length > 0)
	};
};

/** Each foreign key a line can break, and what it means to the person fixing it. */
const GONE: Record<string, [field: string, why: string]> = {
	invoice_line_site_id_fkey: ['site_id', 'That site no longer exists.'],
	invoice_line_paid_by_fkey: ['paid_by', 'That person no longer exists.'],
	invoice_line_material_id_fkey: ['material_id', 'That item no longer exists.']
};

/** The client's site a line names, for its rate, or why it cannot be named. */
async function siteOf(draft: { entity_id: string; who: string }, siteId: string | null) {
	if (!siteId) return { site: null, why: null };
	const [site] = await db
		.select({ rate: t.site.taxRatePct })
		.from(t.site)
		.where(and(eq(t.site.id, siteId), eq(t.site.entityId, draft.entity_id)));
	return site ? { site, why: null } : { site: null, why: `Not one of ${draft.who}'s sites.` };
}

/** A save that failed in the database, said to the person who tried it. */
function refused(e: unknown) {
	const pg = pgError(e);
	const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
	if (gone) return fail(400, { errors: { [gone[0]]: gone[1] } });
	// The triggers that freeze a sent invoice's lines and what they drew
	// (integrity_constraint_violation): it went out between this page and the
	// save.
	if (pg.code === '23000')
		return fail(409, {
			errors: { kind: 'This invoice has gone out, so it takes no more lines.' }
		});
	throw e;
}

/**
 * Goods drawn from stock: off the oldest lots first, costed as the business
 * costs its stock, and sold at the material's price.
 *
 * The material's row is locked first, so two draws of it are made one after
 * the other: the second reads the shelf the first left. The lock is one a
 * foreign key does not wait on, so stock still arrives while a draw is made. A
 * draw larger than what is left is refused here, and by each lot's own check
 * besides.
 */
async function addFromStock(
	draft: { id: string; entity_id: string; who: string },
	fields: Record<string, string>,
	userId: string
) {
	const id = UUID.test(fields.material_id ?? '') ? fields.material_id : null;
	const [m] = id ? await materials([id]) : [];
	const { values, errors } = readFromStock(fields, m?.places ?? null);
	if (id && !m) errors.material_id = 'That item no longer exists.';
	const siteId = typeof values.site_id === 'string' ? values.site_id : null;
	const { site, why } = await siteOf(draft, siteId);
	if (why) errors.site_id = why;
	if (Object.keys(errors).length > 0 || !m) return fail(400, { errors });

	const [[op], places] = await Promise.all([
		db.select({ rules: t.operator.taxRuleSet, costing: t.operator.stockCosting }).from(t.operator),
		moneyPlaces()
	]);
	const qty = String(values.qty);
	let outcome: { field: string; why: string } | null;
	try {
		outcome = await asUser(userId, async (tx) => {
			await tx
				.select({ id: t.material.id })
				.from(t.material)
				.where(eq(t.material.id, m.id))
				.for('no key update');
			const shelf = (await shelves([m.id], tx)).get(m.id)!;
			const draw = drawFrom(shelf, qty, op?.costing ?? 'average');
			if ('short' in draw)
				return {
					field: 'qty',
					why: draw.short.isZero()
						? 'None left on the shelf.'
						: `Only ${quantity(draw.short.toString())} ${m.short} on the shelf.`
				};
			const line = fromStock(
				{
					qty,
					unit: m.unit,
					cost: draw.exTaxCost.toString(),
					taxPaid: draw.taxPaid.toString(),
					listed: m.listed,
					markupPct: m.markup,
					taxable: m.taxable
				},
				{ ruleSet: op?.rules ?? 'none', siteRatePct: site?.rate ?? null, places }
			);
			if (line.needsASite)
				return { field: 'site_id', why: 'Where it went, so its tax rate is known.' };

			const [{ seq }] = await tx
				.select({ seq: sql<number>`coalesce(max(${t.invoiceLine.seq}), 0)::int + 1` })
				.from(t.invoiceLine)
				.where(eq(t.invoiceLine.invoiceId, draft.id));
			const [added] = await tx
				.insert(t.invoiceLine)
				.values({
					invoiceId: draft.id,
					seq,
					kind: 'material',
					description: String(values.description),
					qty: line.qty,
					unit: line.unit,
					unitPrice: line.unitPrice,
					amount: line.amount,
					taxable: line.taxable,
					taxRatePct: line.taxRatePct,
					taxSource: line.taxSource,
					exTaxCost: line.exTaxCost,
					taxPaid: line.taxPaid,
					siteId,
					materialId: m.id
				})
				.returning({ id: t.invoiceLine.id });
			await tx.insert(t.stockDraw).values(
				draw.takes.map((take) => ({
					invoiceLineId: added.id,
					materialLotId: take.lotId,
					materialId: m.id,
					qty: take.qty.toString()
				}))
			);
			return null;
		});
	} catch (e) {
		return refused(e);
	}
	if (outcome) return fail(400, { errors: { [outcome.field]: outcome.why } });
	redirect(303, `/invoices/${draft.id}`);
}

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		const draft = await draftOf(params.id);
		if (draft.status !== 'draft')
			return fail(409, {
				errors: { kind: 'This invoice has gone out, so it takes no more lines.' }
			});

		const form = await request.formData();
		const fields = Object.fromEntries(
			[...form.entries()].filter((e): e is [string, string] => typeof e[1] === 'string')
		);
		if (fields.kind === 'material') return addFromStock(draft, fields, locals.user!.id);
		const { values, errors } = readPassedOn(fields);

		// The site, which must be this client's, for its tax rate.
		const siteId = typeof values.site_id === 'string' ? values.site_id : null;
		const { site, why } = await siteOf(draft, siteId);
		if (why) errors.site_id = why;

		const file = form.get('receipt');
		let receipt: { bytes: Buffer; type: string } | null = null;
		if (file instanceof File && file.size > 0) {
			if (!(RECEIPT_TYPES as readonly string[]).includes(file.type))
				errors.receipt = 'A photo, or a PDF.';
			else if (file.size > MAX_RECEIPT)
				errors.receipt = `Under 2 MB — that is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
			else receipt = { bytes: Buffer.from(await file.arrayBuffer()), type: file.type };
		}
		if (Object.keys(errors).length > 0) return fail(400, { errors });

		const [op] = await db
			.select({ markup: t.operator.purchaseMarkupPct, rules: t.operator.taxRuleSet })
			.from(t.operator);
		const line = passedOn(
			{
				kind: values.kind as 'bought' | 'paid_for',
				cost: String(values.ex_tax_cost),
				taxPaid: String(values.tax_paid)
			},
			{
				purchaseMarkupPct: op?.markup ?? '0',
				ruleSet: op?.rules ?? 'none',
				siteRatePct: site?.rate ?? null,
				places: await moneyPlaces()
			}
		);
		if (line.needsASite)
			return fail(400, { errors: { site_id: 'Where it went, so its tax rate is known.' } });

		try {
			await asUser(locals.user!.id, async (tx) => {
				const [{ seq }] = await tx
					.select({ seq: sql<number>`coalesce(max(${t.invoiceLine.seq}), 0)::int + 1` })
					.from(t.invoiceLine)
					.where(eq(t.invoiceLine.invoiceId, draft.id));
				await tx.insert(t.invoiceLine).values({
					invoiceId: draft.id,
					seq,
					kind: String(values.kind) as 'bought' | 'paid_for',
					description: String(values.description),
					qty: line.qty,
					unit: line.unit,
					unitPrice: line.unitPrice,
					amount: line.amount,
					taxable: line.taxable,
					taxRatePct: line.taxRatePct,
					taxSource: line.taxSource,
					exTaxCost: line.exTaxCost,
					taxPaid: line.taxPaid,
					siteId,
					boughtFrom: values.bought_from === null ? null : String(values.bought_from),
					paidBy: values.paid_by === null ? null : String(values.paid_by),
					receipt: receipt?.bytes ?? null,
					receiptType: receipt?.type ?? null
				});
			});
		} catch (e) {
			return refused(e);
		}
		redirect(303, `/invoices/${draft.id}`);
	}
};
