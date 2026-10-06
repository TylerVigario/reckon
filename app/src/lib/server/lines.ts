import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { asUser, db, type Tx } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { RECEIPT_TYPES } from './db/schema/catalogue.ts';
import { moneyPlaces } from './business.ts';
import { businessToday } from './calendar.ts';
import { pgError, type Errors } from './field-errors.ts';
import { shelves } from './stock.ts';
import { fromStock, passedOn } from '../passed-on.ts';
import { readFromStock, readPassedOn } from '../line-fields.ts';
import { drawFrom } from '../stock-draw.ts';
import { quantity } from '../format.ts';
import { UUID } from '../field-rules.ts';
import { startIn } from './drafts.ts';

/**
 * A LINE ADDED TO A DRAFT BY HAND: goods drawn from stock (#lib/stock-draw),
 * goods bought for the job, or a cost paid on the client's behalf, each bought
 * or paid for with who paid and its receipt (#lib/passed-on).
 *
 * A line is written on the phone first and sent when there is a signal, as a
 * time entry is (#lib/queue), so this is reached from /api/lines, and may be
 * reached twice for one line: the uuid the phone made for it answers the second
 * time with the line the first one added. The draft it is for is named by the
 * server's id, or -- one started on the phone -- by the uuid the phone made for
 * it.
 *
 * A DRAFT THAT WENT OUT before the line arrived cannot take it. The line starts
 * a new draft for that client instead, numbered now, and says which it was
 * meant for; the next line meant for the same one joins it there.
 *
 * What a line from stock cost is worked out here, off the shelf as it stands
 * when the line arrives. What the phone showed was a preview.
 */

/** What the phone sends is shrunk to well under this; the column holds no more. */
const MAX_RECEIPT = 2 * 1024 * 1024;

export type Added =
	| { ok: true; id: string }
	| { ok: false; status: 400 | 404 | 409; detail: string; errors?: Errors };

/**
 * A refusal made inside a line's transaction, thrown so the transaction rolls
 * back: a draft started for a line that is then refused must not be left
 * behind empty.
 */
class Refused extends Error {
	constructor(readonly added: Added) {
		super('refused');
	}
}

/** Refused, with a sentence for the person and, where there is one, the box it is about. */
const no = (errors: Errors): Added => {
	const all = Object.values(errors);
	return {
		ok: false,
		status: 400,
		detail: all.length === 1 ? all[0] : `${all.length} values were refused.`,
		errors
	};
};

/**
 * Materials, or some: what each is counted in, what it sells at -- the price
 * listed today, or its markup on what it cost -- and whether it is goods the
 * business taxes. Without ids, every active one.
 */
export function materials(ids?: string[]) {
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
 * What Add a line needs besides the draft and its sites, to say what a line
 * will bill as it is typed with no signal: who might have paid, the business's
 * terms, and what is on the shelf.
 */
export async function formTerms() {
	const [people, [op], places, all] = await Promise.all([
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
	const onShelf = await shelves(all.map((m) => m.id));
	return {
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
}

/** Each foreign key a line can break, and what it means to the person fixing it. */
const GONE: Record<string, [field: string, why: string]> = {
	invoice_line_site_id_fkey: ['site_id', 'That site no longer exists.'],
	invoice_line_paid_by_fkey: ['paid_by', 'That person no longer exists.'],
	invoice_line_material_id_fkey: ['material_id', 'That item no longer exists.']
};

/** The line a phone already sent, by the uuid it made for it. */
async function sentBefore(clientUuid: string) {
	const [had] = await db
		.select({ id: t.invoiceLine.id })
		.from(t.invoiceLine)
		.where(eq(t.invoiceLine.clientUuid, clientUuid));
	return had ?? null;
}

/** A save that failed in the database, said to the person who tried it. */
async function refused(e: unknown, clientUuid: string, number: string): Promise<Added> {
	if (e instanceof Refused) return e.added;
	const pg = pgError(e);
	// The same line, sent twice at once: the other copy is in.
	if (pg.code === '23505' && pg.constraint === 'invoice_line_client_uuid_key') {
		const had = await sentBefore(clientUuid);
		if (had) return { ok: true, id: had.id };
	}
	const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
	if (gone) return no({ [gone[0]]: gone[1] });
	// The triggers that freeze a sent invoice's lines and what they drew
	// (integrity_constraint_violation). The invoice is locked while a line is
	// added, so this is a writer that did not lock it.
	if (pg.code === '23000')
		return { ok: false, status: 409, detail: `${number} has gone out, so it takes no more lines.` };
	throw e;
}

/** The client's site a line names, for its rate, or why it cannot be named. */
async function siteOf(draft: { entity_id: string; who: string }, siteId: string | null) {
	if (!siteId) return { site: null, why: null };
	const [site] = await db
		.select({ rate: t.site.taxRatePct })
		.from(t.site)
		.where(and(eq(t.site.id, siteId), eq(t.site.entityId, draft.entity_id)));
	return site ? { site, why: null } : { site: null, why: `Not one of ${draft.who}'s sites.` };
}

type Draft = { id: string; number: string; entity_id: string; who: string };

/**
 * Where a line goes: the draft it was meant for, or -- that one having gone out
 * -- the draft its lines started for the client, or a new one. The invoice is
 * locked while the line is added, so it cannot go out in between, and two lines
 * meant for one that has cannot start two drafts.
 */
async function target(
	tx: Tx,
	meant: Draft,
	userId: string
): Promise<{ id: string; number: string; movedFrom: string | null }> {
	const [now] = await tx
		.select({ status: t.invoice.status })
		.from(t.invoice)
		.where(eq(t.invoice.id, meant.id))
		.for('no key update');
	if (now?.status === 'draft') return { id: meant.id, number: meant.number, movedFrom: null };
	const [started] = await tx
		.select({ id: t.invoice.id, number: t.invoice.number })
		.from(t.invoiceLine)
		.innerJoin(t.invoice, eq(t.invoice.id, t.invoiceLine.invoiceId))
		.where(and(eq(t.invoiceLine.movedFromInvoiceId, meant.id), eq(t.invoice.status, 'draft')))
		.limit(1);
	const to = started ?? (await startIn(tx, { entityId: meant.entity_id, userId }));
	return { ...to, movedFrom: meant.id };
}

/**
 * Adds a line to a draft: the fields as the form names them (#lib/line-fields),
 * and its receipt where it has one. Answers with the line, or why not.
 */
export async function addLine(input: {
	invoiceId: string;
	clientUuid: string;
	fields: Record<string, string>;
	receipt: File | null;
	userId: string;
}): Promise<Added> {
	const had = await sentBefore(input.clientUuid);
	if (had) return { ok: true, id: had.id };

	const [draft] = await db
		.select({
			id: t.invoice.id,
			number: t.invoice.number,
			entity_id: t.invoice.entityId,
			who: t.entity.name
		})
		.from(t.invoice)
		.innerJoin(t.entity, eq(t.entity.id, t.invoice.entityId))
		.where(or(eq(t.invoice.id, input.invoiceId), eq(t.invoice.clientUuid, input.invoiceId)));
	if (!draft) return { ok: false, status: 404, detail: 'That draft no longer exists.' };

	return input.fields.kind === 'material'
		? fromTheShelf(draft, input)
		: boughtOrPaidFor(draft, input);
}

/** The next place on the draft. */
const nextSeq = async (tx: Tx, invoiceId: string) => {
	const [{ seq }] = await tx
		.select({ seq: sql<number>`coalesce(max(${t.invoiceLine.seq}), 0)::int + 1` })
		.from(t.invoiceLine)
		.where(eq(t.invoiceLine.invoiceId, invoiceId));
	return seq;
};

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
async function fromTheShelf(
	draft: Draft,
	input: { clientUuid: string; fields: Record<string, string>; userId: string }
): Promise<Added> {
	const id = input.fields.material_id ?? '';
	const [m] = UUID.test(id) ? await materials([id]) : [];
	const { values, errors } = readFromStock(input.fields, m?.places ?? null);
	if (id && !m && !errors.material_id) errors.material_id = 'That item no longer exists.';
	const siteId = typeof values.site_id === 'string' ? values.site_id : null;
	const { site, why } = await siteOf(draft, siteId);
	if (why) errors.site_id = why;
	if (Object.keys(errors).length > 0 || !m) return no(errors);

	const [[op], places] = await Promise.all([
		db.select({ rules: t.operator.taxRuleSet, costing: t.operator.stockCosting }).from(t.operator),
		moneyPlaces()
	]);
	const qty = String(values.qty);
	try {
		return await asUser(input.userId, async (tx): Promise<Added> => {
			const to = await target(tx, draft, input.userId);
			await tx
				.select({ id: t.material.id })
				.from(t.material)
				.where(eq(t.material.id, m.id))
				.for('no key update');
			const shelf = (await shelves([m.id], tx)).get(m.id)!;
			const draw = drawFrom(shelf, qty, op?.costing ?? 'average');
			if ('short' in draw)
				throw new Refused(
					no({
						qty: draw.short.isZero()
							? `None of ${m.name} left on the shelf.`
							: `Only ${quantity(draw.short.toString())} ${m.short} of ${m.name} on the shelf.`
					})
				);
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
				throw new Refused(no({ site_id: 'Where it went, so its tax rate is known.' }));

			const [added] = await tx
				.insert(t.invoiceLine)
				.values({
					clientUuid: input.clientUuid,
					invoiceId: to.id,
					movedFromInvoiceId: to.movedFrom,
					seq: await nextSeq(tx, to.id),
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
			return { ok: true, id: added.id };
		});
	} catch (e) {
		return refused(e, input.clientUuid, draft.number);
	}
}

/** Goods bought for the job, or a cost paid on the client's behalf, with its receipt. */
async function boughtOrPaidFor(
	draft: Draft,
	input: {
		clientUuid: string;
		fields: Record<string, string>;
		receipt: File | null;
		userId: string;
	}
): Promise<Added> {
	const { values, errors } = readPassedOn(input.fields);
	const siteId = typeof values.site_id === 'string' ? values.site_id : null;
	const { site, why } = await siteOf(draft, siteId);
	if (why) errors.site_id = why;

	const file = input.receipt;
	let receipt: { bytes: Buffer; type: string } | null = null;
	if (file && file.size > 0) {
		if (!(RECEIPT_TYPES as readonly string[]).includes(file.type))
			errors.receipt = 'A photo, or a PDF.';
		else if (file.size > MAX_RECEIPT)
			errors.receipt = `Under 2 MB — that is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
		else receipt = { bytes: Buffer.from(await file.arrayBuffer()), type: file.type };
	}
	if (Object.keys(errors).length > 0) return no(errors);

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
	if (line.needsASite) return no({ site_id: 'Where it went, so its tax rate is known.' });

	try {
		return await asUser(input.userId, async (tx): Promise<Added> => {
			const to = await target(tx, draft, input.userId);
			const [added] = await tx
				.insert(t.invoiceLine)
				.values({
					clientUuid: input.clientUuid,
					invoiceId: to.id,
					movedFromInvoiceId: to.movedFrom,
					seq: await nextSeq(tx, to.id),
					kind: values.kind as 'bought' | 'paid_for',
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
				})
				.returning({ id: t.invoiceLine.id });
			return { ok: true, id: added.id };
		});
	} catch (e) {
		return refused(e, input.clientUuid, draft.number);
	}
}
