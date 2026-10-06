import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { RECEIPT_TYPES } from '#lib/server/db/schema/catalogue.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import { pgError } from '#lib/server/field-errors.ts';
import { passedOn } from '#lib/passed-on.ts';
import { readPassedOn } from '#lib/line-fields.ts';
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
 * A line added to a draft by hand: goods bought for the job, or a cost paid on
 * the client's behalf, each with who paid and its receipt (#lib/passed-on).
 * What is drawn from stock comes next.
 *
 * A file is not a field, so this is a form action, as receiving stock is.
 */
export const load: PageServerLoad = async ({ params }) => {
	const draft = await draftOf(params.id);
	if (draft.status !== 'draft') redirect(303, `/invoices/${draft.id}`);
	const [sites, people, [op], places] = await Promise.all([
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
			.select({ markup: t.operator.purchaseMarkupPct, rules: t.operator.taxRuleSet })
			.from(t.operator),
		moneyPlaces()
	]);
	return {
		draft,
		sites,
		people,
		markup: op?.markup ?? '0',
		rules: op?.rules ?? 'none',
		places
	};
};

/** Each foreign key a line can break, and what it means to the person fixing it. */
const GONE: Record<string, [field: string, why: string]> = {
	invoice_line_site_id_fkey: ['site_id', 'That site no longer exists.'],
	invoice_line_paid_by_fkey: ['paid_by', 'That person no longer exists.']
};

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
		const { values, errors } = readPassedOn(fields);

		// The site, which must be this client's, for its tax rate.
		const siteId = typeof values.site_id === 'string' ? values.site_id : null;
		const [site] = siteId
			? await db
					.select({ rate: t.site.taxRatePct })
					.from(t.site)
					.where(and(eq(t.site.id, siteId), eq(t.site.entityId, draft.entity_id)))
			: [];
		if (siteId && !site) errors.site_id = `Not one of ${draft.who}'s sites.`;

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
			const pg = pgError(e);
			const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
			if (gone) return fail(400, { errors: { [gone[0]]: gone[1] } });
			// The trigger that freezes a sent invoice's lines (integrity_constraint_
			// violation): it went out between this page and the save.
			if (pg.code === '23000')
				return fail(409, {
					errors: { kind: 'This invoice has gone out, so it takes no more lines.' }
				});
			throw e;
		}
		redirect(303, `/invoices/${draft.id}`);
	}
};
