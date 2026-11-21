import { sql } from 'kysely';
import { materialNamed } from '#lib/server/named.ts';
import { asUser, db, type Tx } from './db/index.ts';
import type { ReceiptType } from './db/database.ts';
import type { TaxPiece } from './db/tax-pieces.ts';
import { moneyPlaces } from './business.ts';
import { businessToday } from './calendar.ts';
import { pgError, type Errors } from './field-errors.ts';
import { problem } from './problem.ts';
import { shelves } from './stock.ts';
import { fromStock, passedOn, taxNeeds, type ByHand, type Taxes } from '../passed-on.ts';
import { BY_HAND, readByHand, readFromStock, readPassedOn } from '../line-fields.ts';
import { changeDraw, drawFrom } from '../stock-draw.ts';
import { quantity } from '../format.ts';
import { Decimal } from '../decimal.ts';
import { UUID } from '../field-rules.ts';
import { merge, MERGED_FIELDS, same, type Merge } from '../line-merge.ts';
import type { Conflict, Held } from '../line-conflict.ts';
import { startIn } from './drafts.ts';
import { isReceiptType, MAX_RECEIPT } from './receipt-file.ts';
import { areaPieces, piecesFor } from './tax-areas.ts';
import { siteKindRates, siteRate } from './tax-registrations.ts';
import { areaTaxesByState, kindChoices, reckonsKind, taxesByState } from './sale-kinds.ts';

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

export type Added =
	| { ok: true; id: string }
	| {
			ok: false;
			status: 400 | 403 | 404 | 409;
			detail: string;
			errors?: Errors;
			/** What a change made on a phone ran into (#lib/line-conflict). */
			conflict?: Conflict;
	  };

/** The line moved again between being read and being locked: it is read again. */
class MovedOn extends Error {}

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

/**
 * Someone with Field changes, takes off or puts back only a line they added
 * (#lib/access); whoever added it, or someone with Full, does the rest.
 */
const notTheirs: Added = {
	ok: false,
	status: 403,
	detail: 'Whoever added it, or someone with Full, changes it.'
};

/** A line's tax is set by hand by someone with Full alone (#lib/access). */
const notFull: Added = {
	ok: false,
	status: 403,
	detail: 'Someone with Full sets a line’s tax by hand.'
};

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
	return db
		.selectFrom('material')
		.innerJoin('unit', 'unit.id', 'material.unit_id')
		.select((eb) => [
			'material.id',
			'material.name',
			'material.sku',
			'unit.name as unit',
			// How its unit is written beside a figure: "ft", or the name.
			eb.fn.coalesce('unit.short', 'unit.name').as('short'),
			'unit.places',
			eb
				.cast<string>(
					eb.fn.coalesce(
						'material.markup_pct',
						eb.selectFrom('operator').select('operator.default_markup_pct'),
						eb.lit(0)
					),
					'text'
				)
				.as('markup'),
			eb
				.selectFrom('material_price')
				.select((eb) => eb.cast<string | null>('material_price.price', 'text').as('price'))
				.whereRef('material_price.material_id', '=', 'material.id')
				.where('material_price.effective_from', '<=', businessToday())
				.orderBy('material_price.effective_from', 'desc')
				.limit(1)
				.as('listed'),
			// The kind of sale it is, which its state's answer taxes or not.
			'material.sale_kind_id as kind',
			'material.active'
		])
		.where((eb) =>
			ids ? eb('material.id', '=', eb.fn.any(eb.val(ids))) : eb('material.active', '=', true)
		)
		.orderBy('material.name')
		.execute();
}

/**
 * What Add a line needs besides the draft and its sites, to say what a line
 * will bill as it is typed with no signal: who might have paid, the business's
 * terms, and what is on the shelf.
 */
export async function formTerms() {
	const [people, op, places, all, taxes, areaTaxes, goods, kinds] = await Promise.all([
		db
			.selectFrom('user')
			.select(['id', 'name'])
			.where('active', '=', true)
			.orderBy('name')
			.execute(),
		db
			.selectFrom('operator')
			.select([
				'purchase_markup_pct as markup',
				'default_markup_pct as stock',
				'stock_costing as costing'
			])
			.executeTakeFirst(),
		moneyPlaces(),
		materials(),
		taxesByState(db),
		areaTaxesByState(db, businessToday()),
		reckonsKind(db, 'goods'),
		kindChoices(db)
	]);
	const onShelf = await shelves(all.map((m) => m.id));
	return {
		people,
		markup: op?.markup ?? '0',
		// What stock sells at over its cost where a material has no markup of
		// its own: for a material repriced on the phone (#lib/stock-held).
		stock_markup: op?.stock ?? '0',
		// Each state the business collects in, the kinds of sale it taxes
		// there, and those some area of it taxes alone; each site says its
		// state (#lib/server/sale-kinds).
		taxes,
		areaTaxes,
		goods,
		// What each kind of sale is called, so a line says how its kind is taxed.
		kinds: Object.fromEntries(kinds.map((k) => [k.id, k.name])),
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

/**
 * A line's answer as an HTTP response: the line, or a problem document --
 * with what a change made on a phone ran into as an extension member
 * (#lib/line-conflict), which the phone keeps.
 */
export function answer(r: Added) {
	if (r.ok) return Response.json({ id: r.id }, { status: 200 });
	if (r.status === 404) return problem('notFound', 404, r.detail);
	if (r.status === 403) return problem('notYours', 403, r.detail);
	if (r.status === 409)
		return problem(
			'conflict',
			409,
			r.detail,
			r.conflict ? { members: { conflict: r.conflict } } : {}
		);
	return problem('invalidField', 400, r.detail, { errors: r.errors });
}

/** A line's fields, read so they can be put as Add a line puts them (formFieldsOf). */
const LINE_AS_FORM = [
	'invoice_line.id',
	'invoice_line.version',
	'invoice_line.kind',
	'invoice_line.material_id',
	'invoice_line.description',
	'invoice_line.qty',
	'invoice_line.site_id',
	'invoice_line.bought_from',
	'invoice_line.ex_tax_cost',
	'invoice_line.tax_paid',
	'invoice_line.paid_by',
	'invoice_line.taxable',
	'invoice_line.tax_rate_pct',
	'invoice_line.tax_source',
	'invoice_line.tax_override_reason'
] as const;

/** A column's value, however it was read: a string from a query, or JSON's number. */
const str = (v: unknown): string =>
	typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

/**
 * One field as Add a line's form puts it: money to the currency's places, a
 * quantity without the zeros its column pads it with, and nothing for nothing.
 */
export function asTyped(field: string, v: unknown, places: number): string {
	const s = str(v);
	if (s === '') return '';
	if (field === 'ex_tax_cost' || field === 'tax_paid') return Decimal.from(s).toFixed(places);
	if (field === 'qty' || field === 'tax_rate_pct')
		return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
	return s;
}

/**
 * A line's fields as the form names and writes them: what a change is merged
 * against. Its tax is said only where it was set by hand (#lib/line-fields
 * readByHand): whether it is taxed, the rate where it is not the site's, and
 * why. A line taxed as its kind is says nothing of it.
 */
export function formFieldsOf(
	line: Record<string, unknown>,
	places: number
): Record<string, string> {
	const out: Record<string, string> = { kind: str(line.kind), material_id: str(line.material_id) };
	for (const f of MERGED_FIELDS) out[f] = asTyped(f, line[f], places);
	const byHand = str(line.tax_override_reason) !== '';
	out.taxable = byHand ? str(line.taxable) : '';
	out.tax_rate_pct = byHand && line.tax_source === 'override' ? out.tax_rate_pct : '';
	return out;
}

/**
 * A line's tax set by hand, as a change's fields say it -- its three fields
 * together, those not sent empty -- or, where they say nothing of it, as the
 * line `now` is the form of has it.
 */
function byHandSaid(fields: Record<string, string>, now: Record<string, string>) {
	const says = BY_HAND.some((f) => f in fields);
	return Object.fromEntries(BY_HAND.map((f) => [f, (says ? fields[f] : now[f]) ?? '']));
}

/**
 * A line's tax set by hand, from a change's fields, for a line `now` is the
 * form of (byHandSaid). Someone with Field sets none and changes none.
 */
function byHandFor(
	fields: Record<string, string>,
	now: Record<string, string>,
	field: boolean | undefined
): { byHand: ByHand | null; reason: string | null; errors: Errors } | Added {
	const said = byHandSaid(fields, now);
	if (field && BY_HAND.some((f) => !same(f, said[f], now[f]))) return notFull;
	const read = readByHand(said);
	return { byHand: read.byHand ?? null, reason: read.reason, errors: read.errors };
}

/** Who took a line off, and when: the newest removal its history has. */
async function takenOff(lineId: string) {
	const gone = await db
		.selectFrom('record_history as h')
		.leftJoin('user as u', 'u.id', 'h.changed_by')
		.select(['u.name as by', 'h.changed_at as at', 'h.old_value as was'])
		.where('h.table_name', '=', 'invoice_line')
		.where('h.row_id', '=', lineId)
		.where('h.field', '=', '(deleted)')
		.orderBy('h.changed_at', 'desc')
		.limit(1)
		.executeTakeFirst();
	return gone ? { by: gone.by, at: gone.at.toISOString(), was: gone.was } : null;
}

/**
 * A collision, as the phone keeps it: each field that collided with what both
 * began from, the phone's value, the server's, and every value it has held
 * (#lib/line-conflict) -- from the line's history, oldest first, each once.
 */
async function collision(
	lineId: string,
	version: number,
	now: Record<string, string>,
	input: { fields: Record<string, string>; base?: Record<string, string> },
	m: Merge,
	places: number
): Promise<Conflict> {
	const rows = await db
		.selectFrom('record_history as h')
		.leftJoin('user as u', 'u.id', 'h.changed_by')
		.select(['h.field', 'h.new_value as value', 'u.name as who', 'h.changed_at as at', 'h.made_at'])
		.where('h.table_name', '=', 'invoice_line')
		.where('h.row_id', '=', lineId)
		.orderBy('h.changed_at')
		.orderBy('h.id')
		.execute();
	// The line as each save left it, in the form's words: a field's value can
	// turn on another's -- its tax, on whether it was set by hand -- so the
	// history is played forward a save at a time, not read a field at a time.
	const saves: { form: Record<string, string>; row: (typeof rows)[number] }[] = [];
	let state: Record<string, unknown> = {};
	for (const [i, r] of rows.entries()) {
		if (r.field === '(added)') {
			try {
				state = JSON.parse(r.value ?? '{}') as Record<string, unknown>;
			} catch {
				state = {};
			}
		} else if (r.field !== '(deleted)') state = { ...state, [r.field]: r.value };
		const next = rows[i + 1];
		const sameSave =
			next !== undefined &&
			next.field !== '(added)' &&
			next.at.getTime() === r.at.getTime() &&
			next.who === r.who;
		if (!sameSave && r.field !== '(deleted)')
			saves.push({ form: formFieldsOf(state, places), row: r });
	}
	const fields: Extract<Conflict, { what: 'collided' }>['fields'] = {};
	for (const f of m.collided) {
		const chain: Held[] = [];
		for (const { form, row: r } of saves) {
			const value = form[f] ?? '';
			if (chain.some((c) => same(f, c.value, value))) continue;
			chain.push({
				value,
				who: r.who,
				at: r.at.toISOString(),
				made_at: r.made_at?.toISOString() ?? null
			});
		}
		fields[f] = {
			base: input.base?.[f] ?? '',
			mine: input.fields[f] ?? '',
			theirs: now[f] ?? '',
			chain
		};
	}
	const last = rows.filter((r) => !r.field.startsWith('(') && r.field !== 'version').at(-1);
	return {
		what: 'collided',
		version,
		server: now,
		fields,
		from: m.from,
		by: last?.who ?? null,
		at: last?.at.toISOString() ?? null
	};
}

/**
 * The line a phone already sent, by the uuid it made for it: only ever its
 * maker's, since the uuid is unique to them and another's finds nothing.
 */
async function sentBefore(clientUuid: string, userId: string) {
	const had = await db
		.selectFrom('invoice_line')
		.select('id')
		.where('client_uuid', '=', clientUuid)
		.where('created_by', '=', userId)
		.executeTakeFirst();
	return had ?? null;
}

/** A save that failed in the database, said to the person who tried it. */
async function refused(
	e: unknown,
	clientUuid: string,
	userId: string,
	number: string
): Promise<Added> {
	if (e instanceof Refused) return e.added;
	const pg = pgError(e);
	// The same line, sent twice at once: the other copy is in.
	if (pg.code === '23505' && pg.constraint === 'invoice_line_created_by_client_uuid_key') {
		const had = await sentBefore(clientUuid, userId);
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

/**
 * Each state the business collects in and the kinds of sale it taxes there,
 * and those some area of it taxes alone; and the client's site a line names
 * -- its tax (#lib/passed-on SiteTax), its state, and its area's name and
 * pieces -- or why it cannot be named.
 */
async function siteOf(draft: { entity_id: string; who: string }, siteId: string | null) {
	const day = businessToday();
	const [taxes, areaTaxes, goods] = await Promise.all([
		taxesByState(db),
		areaTaxesByState(db, day),
		reckonsKind(db, 'goods')
	]);
	if (!siteId) return { taxes, areaTaxes, goods, site: null, why: null };
	// Its area's rate today, and who levies it (#lib/server/tax-areas), where
	// the business collects in its state.
	const found = await db
		.selectFrom('site')
		.leftJoin('tax_area', 'tax_area.id', 'site.tax_area_id')
		.select((eb) => {
			const site = { region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') };
			return [
				siteRate(site, day).as('rate'),
				siteKindRates(site, day).as('kind_rates'),
				'site.region as state',
				'tax_area.name as jurisdiction',
				areaPieces(eb.ref('site.tax_area_id').$castTo<string>(), day).as('pieces')
			];
		})
		.where('site.id', '=', siteId)
		.where('site.entity_id', '=', draft.entity_id)
		.executeTakeFirst();
	if (!found)
		return { taxes, areaTaxes, goods, site: null, why: `Not one of ${draft.who}'s sites.` };
	const { rate, kind_rates, ...where } = found;
	const tax = { state: where.state, ratePct: rate, kindRates: kind_rates ?? {} };
	return { taxes, areaTaxes, goods, site: { ...where, tax }, why: null };
}

/**
 * Where a taxed line was taxed -- its area's name and its state -- and the
 * pieces its rate was made of where it is the site's -- who levied what --
 * from the same read of the site as the rate, kept with the line as they were
 * then: those for its kind alone, and those on every kind where they fall on
 * it, its state taxing the kind or its tax set by hand to the site's rate
 * (#lib/server/tax-areas piecesFor).
 */
function taxedWhere(
	line: { taxable: boolean; taxSource: string; soldAs: string | null; byHand: boolean },
	site: { state: string; jurisdiction: string | null; pieces: TaxPiece[] } | null,
	taxes: Taxes
) {
	const at = line.taxable && site !== null && site.jurisdiction !== null;
	const own = at && line.taxSource === 'site';
	const everyKind =
		line.byHand || (at && line.soldAs !== null && (taxes[site.state] ?? []).includes(line.soldAs));
	return {
		tax_jurisdiction: at ? site.jurisdiction : null,
		tax_state: at ? site.state : null,
		tax_pieces: own ? JSON.stringify(piecesFor(site.pieces, line.soldAs, everyKind)) : null
	};
}

/** A receipt sent with a line: a photo or a PDF, and no bigger than the column holds. */
async function readReceipt(file: File | null, errors: Errors) {
	if (!file || file.size === 0) return null;
	if (!isReceiptType(file.type)) errors.receipt = 'A photo, or a PDF.';
	else if (file.size > MAX_RECEIPT)
		errors.receipt = `Under 2 MB — that is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
	else return { bytes: Buffer.from(await file.arrayBuffer()), type: file.type };
	return null;
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
	const now = await tx
		.selectFrom('invoice')
		.select('status')
		.where('id', '=', meant.id)
		.forNoKeyUpdate()
		.executeTakeFirst();
	if (now?.status === 'draft') return { id: meant.id, number: meant.number, movedFrom: null };
	const started = await tx
		.selectFrom('invoice_line')
		.innerJoin('invoice', 'invoice.id', 'invoice_line.invoice_id')
		.select(['invoice.id', 'invoice.number'])
		.where('invoice_line.moved_from_invoice_id', '=', meant.id)
		.where('invoice.status', '=', 'draft')
		.limit(1)
		.executeTakeFirst();
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
	/** When it was added, on a phone with no signal. */
	madeAt?: string | null;
	/** A line put back after it was taken off keeps its id, and its receipt where none comes. */
	id?: string;
	kept?: { bytes: Buffer; type: ReceiptType } | null;
	/** Whoever is adding it has Field, and sets no line's tax by hand. */
	field?: boolean;
}): Promise<Added> {
	const had = await sentBefore(input.clientUuid, input.userId);
	if (had) return { ok: true, id: had.id };

	const draft = await db
		.selectFrom('invoice')
		.innerJoin('entity', 'entity.id', 'invoice.entity_id')
		.select(['invoice.id', 'invoice.number', 'invoice.entity_id', 'entity.name as who'])
		// By its id, or by the uuid the phone started it with -- that phone's own
		// draft, so its maker's.
		.where((eb) =>
			eb.or([
				eb('invoice.id', '=', input.invoiceId),
				eb.and([
					eb('invoice.client_uuid', '=', input.invoiceId),
					eb('invoice.created_by', '=', input.userId)
				])
			])
		)
		.executeTakeFirst();
	if (!draft) return { ok: false, status: 404, detail: 'That draft no longer exists.' };

	const read = readByHand(input.fields);
	if (input.field && read.byHand) return notFull;
	const tax = { byHand: read.byHand ?? null, reason: read.reason, errors: read.errors };
	return input.fields.kind === 'material'
		? fromTheShelf(draft, input, tax)
		: boughtOrPaidFor(draft, input, tax);
}

/** A line's tax set by hand, as it was read from its fields (#lib/line-fields readByHand). */
type TaxByHand = { byHand: ByHand | null; reason: string | null; errors: Errors };

/** The next place on the draft. */
const nextSeq = async (tx: Tx, invoiceId: string) => {
	const { seq } = await tx
		.selectFrom('invoice_line')
		.select((eb) =>
			eb(
				eb.cast<number>(eb.fn.coalesce(eb.fn.max('seq'), eb.lit(0)), 'integer'),
				'+',
				eb.lit(1)
			).as('seq')
		)
		.where('invoice_id', '=', invoiceId)
		.executeTakeFirstOrThrow();
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
	input: {
		clientUuid: string;
		fields: Record<string, string>;
		userId: string;
		madeAt?: string | null;
		id?: string;
	},
	tax: TaxByHand
): Promise<Added> {
	const id = await materialNamed(input.fields.material_id ?? '');
	const [m] = UUID.test(id) ? await materials([id]) : [];
	const { values, errors } = readFromStock(input.fields, m?.places ?? null);
	Object.assign(errors, tax.errors);
	if (id && !m && !errors.material_id) errors.material_id = 'That item no longer exists.';
	// Retired is not offered for a new line, one made on a phone meanwhile
	// included; a line put back keeps what it was of, as a line on a draft does.
	if (m && !m.active && !input.id && !errors.material_id)
		errors.material_id = `${m.name} is retired. Offer it again from its record, or choose another.`;
	const siteId = typeof values.site_id === 'string' ? values.site_id : null;
	const { taxes, areaTaxes, site, why } = await siteOf(draft, siteId);
	if (why) errors.site_id = why;
	if (Object.keys(errors).length > 0 || !m) return no(errors);

	const [op, places] = await Promise.all([
		db.selectFrom('operator').select(['stock_costing as costing']).executeTakeFirst(),
		moneyPlaces()
	]);
	const qty = String(values.qty);
	try {
		return await asUser(
			input.userId,
			async (tx): Promise<Added> => {
				const to = await target(tx, draft, input.userId);
				await tx
					.selectFrom('material')
					.select('id')
					.where('id', '=', m.id)
					.forNoKeyUpdate()
					.execute();
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
						kind: m.kind,
						byHand: tax.byHand
					},
					{ taxes, areaTaxes, site: site?.tax ?? null, places }
				);
				const needs = taxNeeds(line);
				if (needs) throw new Refused(no(needs));

				const added = await tx
					.insertInto('invoice_line')
					.values({
						...(input.id ? { id: input.id } : {}),
						client_uuid: input.clientUuid,
						created_by: input.userId,
						invoice_id: to.id,
						moved_from_invoice_id: to.movedFrom,
						seq: await nextSeq(tx, to.id),
						kind: 'material',
						description: String(values.description),
						qty: line.qty,
						unit: line.unit,
						unit_price: line.unitPrice,
						amount: line.amount,
						taxable: line.taxable,
						tax_rate_pct: line.taxRatePct,
						tax_source: line.taxSource,
						tax_override_reason: tax.reason,
						sale_kind_id: line.soldAs,
						...taxedWhere(line, site, taxes),
						ex_tax_cost: line.exTaxCost,
						tax_paid: line.taxPaid,
						site_id: siteId,
						material_id: m.id
					})
					.returning('id')
					.executeTakeFirstOrThrow();
				await tx
					.insertInto('stock_draw')
					.values(
						draw.takes.map((take) => ({
							invoice_line_id: added.id,
							material_lot_id: take.lotId,
							material_id: m.id,
							qty: take.qty.toString()
						}))
					)
					.execute();
				return { ok: true, id: added.id };
			},
			input.madeAt
		);
	} catch (e) {
		return refused(e, input.clientUuid, input.userId, draft.number);
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
		madeAt?: string | null;
		id?: string;
		kept?: { bytes: Buffer; type: ReceiptType } | null;
	},
	tax: TaxByHand
): Promise<Added> {
	const { values, errors } = readPassedOn(input.fields);
	Object.assign(errors, tax.errors);
	if (values.kind === 'paid_for' && tax.byHand)
		errors.taxable = 'A cost passed on is no sale, so it is taxed nowhere.';
	const siteId = typeof values.site_id === 'string' ? values.site_id : null;
	const { taxes, areaTaxes, goods, site, why } = await siteOf(draft, siteId);
	if (why) errors.site_id = why;

	const receipt = (await readReceipt(input.receipt, errors)) ?? input.kept ?? null;
	if (Object.keys(errors).length > 0) return no(errors);

	const op = await db
		.selectFrom('operator')
		.select(['purchase_markup_pct as markup'])
		.executeTakeFirst();
	const line = passedOn(
		{
			kind: values.kind as 'bought' | 'paid_for',
			cost: String(values.ex_tax_cost),
			taxPaid: String(values.tax_paid),
			byHand: tax.byHand
		},
		{
			purchaseMarkupPct: op?.markup ?? '0',
			taxes,
			areaTaxes,
			goods,
			site: site?.tax ?? null,
			places: await moneyPlaces()
		}
	);
	const needs = taxNeeds(line);
	if (needs) return no(needs);

	try {
		return await asUser(
			input.userId,
			async (tx): Promise<Added> => {
				const to = await target(tx, draft, input.userId);
				const added = await tx
					.insertInto('invoice_line')
					.values({
						...(input.id ? { id: input.id } : {}),
						client_uuid: input.clientUuid,
						created_by: input.userId,
						invoice_id: to.id,
						moved_from_invoice_id: to.movedFrom,
						seq: await nextSeq(tx, to.id),
						kind: values.kind as 'bought' | 'paid_for',
						description: String(values.description),
						qty: line.qty,
						unit: line.unit,
						unit_price: line.unitPrice,
						amount: line.amount,
						taxable: line.taxable,
						tax_rate_pct: line.taxRatePct,
						tax_source: line.taxSource,
						tax_override_reason: tax.reason,
						sale_kind_id: line.soldAs,
						...taxedWhere(line, site, taxes),
						ex_tax_cost: line.exTaxCost,
						tax_paid: line.taxPaid,
						site_id: siteId,
						bought_from: values.bought_from === null ? null : String(values.bought_from),
						paid_by: values.paid_by === null ? null : String(values.paid_by),
						receipt: receipt?.bytes ?? null,
						receipt_type: receipt?.type ?? null
					})
					.returning('id')
					.executeTakeFirstOrThrow();
				return { ok: true, id: added.id };
			},
			input.madeAt
		);
	} catch (e) {
		return refused(e, input.clientUuid, input.userId, draft.number);
	}
}

/**
 * CHANGING A LINE ADDED BY HAND, on a draft: its fields as Add a line names
 * them, read as they are read when it is added, and its receipt kept unless
 * another comes. Its kind, and the item a line from stock is of, stay what they
 * were: a different thing is a different line. A line from stock that changes
 * how much it draws takes more off the shelf, or puts some back
 * (#lib/stock-draw changeDraw). What it bills is worked out again, as it was
 * when it was added. Every field that changes goes into its history.
 */
export async function changeLine(
	input: {
		lineId: string;
		fields: Record<string, string>;
		receipt: File | null;
		userId: string;
		/**
		 * The save of the line the change began from, and its fields then. Given,
		 * a line changed meanwhile is merged with it field by field
		 * (#lib/line-merge); a field both changed differently is a collision.
		 */
		version?: number;
		base?: Record<string, string>;
		/** When the change was made, on a phone with no signal. */
		madeAt?: string | null;
		/** Whoever is changing it has Field, and changes only a line they added. */
		field?: boolean;
	},
	attempt = 0
): Promise<Added> {
	const line = await db
		.selectFrom('invoice_line')
		.innerJoin('invoice', 'invoice.id', 'invoice_line.invoice_id')
		.innerJoin('entity', 'entity.id', 'invoice.entity_id')
		.select(LINE_AS_FORM)
		.select([
			'invoice_line.created_by',
			'invoice_line.invoice_id',
			'invoice.number',
			'invoice.status',
			'invoice.entity_id',
			'entity.name as who'
		])
		.where('invoice_line.id', '=', input.lineId)
		.executeTakeFirst();
	if (!line) {
		const gone = await takenOff(input.lineId);
		return gone
			? {
					ok: false,
					status: 409,
					detail: `${gone.by ?? 'Someone'} took this line off while the change was on its way.`,
					conflict: { what: 'removed', by: gone.by, at: gone.at }
				}
			: { ok: false, status: 404, detail: 'That line is no longer on the draft.' };
	}
	const draft = {
		id: line.invoice_id,
		number: line.number,
		entity_id: line.entity_id,
		who: line.who
	};
	const goneOut = (): Added => ({
		ok: false,
		status: 409,
		detail: `${line.number} has gone out, so its lines are as they were sent.`
	});
	if (line.status !== 'draft') return goneOut();
	if (input.field && line.created_by !== input.userId) return notTheirs;
	if (line.kind !== 'material' && line.kind !== 'bought' && line.kind !== 'paid_for')
		return no({ kind: 'Only a line added by hand can be changed here.' });

	// Changed meanwhile: merged with the change, field by field, against what
	// the change began from.
	const places = await moneyPlaces();
	const now = formFieldsOf(line, places);
	if (input.version !== undefined && input.base && line.version !== input.version) {
		const m = merge(input.base, input.fields, now);
		if (m.collided.length > 0)
			return {
				ok: false,
				status: 409,
				detail: 'Someone else changed this line as well, and a field needs a choice.',
				conflict: await collision(line.id, line.version, now, input, m, places)
			};
		input = { ...input, fields: { ...m.fields, kind: line.kind } };
	}
	// Its tax set by hand: as the change says, or as the line has it where the
	// change says nothing of it.
	const tax = byHandFor(input.fields, now, input.field);
	if ('ok' in tax) return tax;

	/**
	 * The draft locked while the line changes, so it cannot go out in between;
	 * and the line still the save it was read as, or it is read again.
	 */
	const stillADraft = async (tx: Tx) => {
		const now = await tx
			.selectFrom('invoice')
			.select('status')
			.where('id', '=', line.invoice_id)
			.forNoKeyUpdate()
			.executeTakeFirst();
		if (now?.status !== 'draft') throw new Refused(goneOut());
		const same = await tx
			.selectFrom('invoice_line')
			.select('version')
			.where('id', '=', line.id)
			.executeTakeFirst();
		if (same?.version !== line.version) throw new MovedOn();
	};

	try {
		if (line.kind === 'material') {
			const [m] = await materials([line.material_id!]);
			const { values, errors } = readFromStock(
				{ ...input.fields, material_id: line.material_id ?? '' },
				m?.places ?? null
			);
			Object.assign(errors, tax.errors);
			const siteId = typeof values.site_id === 'string' ? values.site_id : null;
			const { taxes, areaTaxes, site, why } = await siteOf(draft, siteId);
			if (why) errors.site_id = why;
			if (Object.keys(errors).length > 0 || !m) return no(errors);
			const op = await db
				.selectFrom('operator')
				.select(['stock_costing as costing'])
				.executeTakeFirst();
			const qty = String(values.qty);
			return await asUser(
				input.userId,
				async (tx): Promise<Added> => {
					await stillADraft(tx);
					await tx
						.selectFrom('material')
						.select('id')
						.where('id', '=', m.id)
						.forNoKeyUpdate()
						.execute();
					// What it draws now, read under the lock: another change may have
					// been made since it was read above.
					const was = await tx
						.selectFrom('invoice_line')
						.select(['qty', 'ex_tax_cost', 'tax_paid'])
						.where('id', '=', line.id)
						.executeTakeFirst();
					if (!was)
						throw new Refused({
							ok: false,
							status: 404,
							detail: 'That line is no longer on the draft.'
						});
					const shelf = (await shelves([m.id], tx)).get(m.id)!;
					const change = changeDraw(
						shelf,
						{ qty: was.qty, exTaxCost: was.ex_tax_cost ?? '0', taxPaid: was.tax_paid ?? '0' },
						qty,
						op?.costing ?? 'average'
					);
					if ('short' in change)
						throw new Refused(
							no({
								qty: `Only ${quantity(change.short.add(was.qty).toString())} ${m.short} of ${m.name} can be on this line: the shelf has ${quantity(change.short.toString())} more.`
							})
						);
					const priced = fromStock(
						{
							qty,
							unit: m.unit,
							cost: change.exTaxCost.toString(),
							taxPaid: change.taxPaid.toString(),
							listed: m.listed,
							markupPct: m.markup,
							kind: m.kind,
							byHand: tax.byHand
						},
						{ taxes, areaTaxes, site: site?.tax ?? null, places }
					);
					const needs = taxNeeds(priced);
					if (needs) throw new Refused(no(needs));

					// More off the oldest lots, as any draw; what goes back, off the
					// newest this line drew from first.
					for (const take of change.takes)
						await tx
							.insertInto('stock_draw')
							.values({
								invoice_line_id: line.id,
								material_lot_id: take.lotId,
								material_id: m.id,
								qty: take.qty.toString()
							})
							.onConflict((oc) =>
								oc.columns(['invoice_line_id', 'material_lot_id']).doUpdateSet((eb) => ({
									qty: sql<string>`${eb.ref('stock_draw.qty')} + ${eb.ref('excluded.qty')}`
								}))
							)
							.execute();
					let back = change.back;
					if (back.gt(0)) {
						const drawn = await tx
							.selectFrom('stock_draw')
							.innerJoin('material_lot', 'material_lot.id', 'stock_draw.material_lot_id')
							.select(['stock_draw.material_lot_id as lot', 'stock_draw.qty'])
							.where('stock_draw.invoice_line_id', '=', line.id)
							.orderBy('material_lot.received_on', 'desc')
							.orderBy('material_lot.id', 'desc')
							.execute();
						for (const d of drawn) {
							if (back.isZero()) break;
							const put = Decimal.min(back, Decimal.from(d.qty));
							const which = { invoice_line_id: line.id, material_lot_id: d.lot };
							if (put.eq(d.qty))
								await tx
									.deleteFrom('stock_draw')
									.where((eb) => eb.and(which))
									.execute();
							else
								await tx
									.updateTable('stock_draw')
									.set({ qty: Decimal.from(d.qty).sub(put).toString() })
									.where((eb) => eb.and(which))
									.execute();
							back = back.sub(put);
						}
					}
					await tx
						.updateTable('invoice_line')
						.set({
							description: String(values.description),
							qty: priced.qty,
							unit_price: priced.unitPrice,
							amount: priced.amount,
							taxable: priced.taxable,
							tax_rate_pct: priced.taxRatePct,
							tax_source: priced.taxSource,
							tax_override_reason: tax.reason,
							sale_kind_id: priced.soldAs,
							...taxedWhere(priced, site, taxes),
							ex_tax_cost: priced.exTaxCost,
							tax_paid: priced.taxPaid,
							site_id: siteId
						})
						.where('id', '=', line.id)
						.execute();
					return { ok: true, id: line.id };
				},
				input.madeAt
			);
		}

		const { values, errors } = readPassedOn({ ...input.fields, kind: line.kind });
		Object.assign(errors, tax.errors);
		if (line.kind === 'paid_for' && tax.byHand)
			errors.taxable = 'A cost passed on is no sale, so it is taxed nowhere.';
		const siteId = typeof values.site_id === 'string' ? values.site_id : null;
		const { taxes, areaTaxes, goods, site, why } = await siteOf(draft, siteId);
		if (why) errors.site_id = why;
		const receipt = await readReceipt(input.receipt, errors);
		if (Object.keys(errors).length > 0) return no(errors);
		const op = await db
			.selectFrom('operator')
			.select(['purchase_markup_pct as markup'])
			.executeTakeFirst();
		const priced = passedOn(
			{
				kind: line.kind,
				cost: String(values.ex_tax_cost),
				taxPaid: String(values.tax_paid),
				byHand: tax.byHand
			},
			{
				purchaseMarkupPct: op?.markup ?? '0',
				taxes,
				areaTaxes,
				goods,
				site: site?.tax ?? null,
				places
			}
		);
		const needs = taxNeeds(priced);
		if (needs) return no(needs);
		return await asUser(
			input.userId,
			async (tx): Promise<Added> => {
				await stillADraft(tx);
				await tx
					.updateTable('invoice_line')
					.set({
						description: String(values.description),
						unit_price: priced.unitPrice,
						amount: priced.amount,
						taxable: priced.taxable,
						tax_rate_pct: priced.taxRatePct,
						tax_source: priced.taxSource,
						tax_override_reason: tax.reason,
						sale_kind_id: priced.soldAs,
						...taxedWhere(priced, site, taxes),
						ex_tax_cost: priced.exTaxCost,
						tax_paid: priced.taxPaid,
						site_id: siteId,
						bought_from: values.bought_from === null ? null : String(values.bought_from),
						paid_by: values.paid_by === null ? null : String(values.paid_by),
						// Kept unless another comes.
						...(receipt ? { receipt: receipt.bytes, receipt_type: receipt.type } : {})
					})
					.where('id', '=', line.id)
					.execute();
				return { ok: true, id: line.id };
			},
			input.madeAt
		);
	} catch (e) {
		if (e instanceof Refused) return e.added;
		if (e instanceof MovedOn && attempt < 3) return changeLine(input, attempt + 1);
		const pg = pgError(e);
		const gone = pg.code === '23503' ? GONE[pg.constraint ?? ''] : undefined;
		if (gone) return no({ [gone[0]]: gone[1] });
		if (pg.code === '23000') return goneOut();
		throw e;
	}
}

/**
 * Takes a line off its draft. What one from stock drew goes back to the shelf
 * with it (0017), and what it was goes into its history, receipt and all (0021,
 * 0022). A line already gone is what was asked for. Taken off on a phone and
 * changed by someone meanwhile, it is asked about first, unless `force`.
 */
export async function removeLine(input: {
	lineId: string;
	userId: string;
	version?: number;
	force?: boolean;
	madeAt?: string | null;
	/** Whoever is taking it off has Field, and takes off only a line they added. */
	field?: boolean;
}): Promise<Added> {
	const line = await db
		.selectFrom('invoice_line')
		.innerJoin('invoice', 'invoice.id', 'invoice_line.invoice_id')
		.select([
			'invoice_line.id',
			'invoice_line.created_by',
			'invoice_line.version',
			'invoice_line.invoice_id',
			'invoice.number'
		])
		.where('invoice_line.id', '=', input.lineId)
		.executeTakeFirst();
	if (!line) return { ok: true, id: input.lineId };
	if (input.field && line.created_by !== input.userId) return notTheirs;
	if (input.version !== undefined && !input.force && line.version !== input.version) {
		const last = await db
			.selectFrom('record_history as h')
			.leftJoin('user as u', 'u.id', 'h.changed_by')
			.select(['u.name as by', 'h.changed_at as at'])
			.where('h.table_name', '=', 'invoice_line')
			.where('h.row_id', '=', line.id)
			.where('h.field', 'not like', '(%')
			.orderBy('h.changed_at', 'desc')
			.limit(1)
			.executeTakeFirst();
		return {
			ok: false,
			status: 409,
			detail: `${last?.by ?? 'Someone'} changed this line after it was taken off on the phone.`,
			conflict: { what: 'changed', by: last?.by ?? null, at: last?.at.toISOString() ?? null }
		};
	}
	const goneOut: Added = {
		ok: false,
		status: 409,
		detail: `${line.number} has gone out, so its lines are as they were sent.`
	};
	try {
		return await asUser(
			input.userId,
			async (tx): Promise<Added> => {
				const now = await tx
					.selectFrom('invoice')
					.select('status')
					.where('id', '=', line.invoice_id)
					.forNoKeyUpdate()
					.executeTakeFirst();
				if (now?.status !== 'draft') return goneOut;
				await tx.deleteFrom('invoice_line').where('id', '=', line.id).execute();
				return { ok: true, id: line.id };
			},
			input.madeAt
		);
	} catch (e) {
		if (pgError(e).code === '23000') return goneOut;
		throw e;
	}
}

/**
 * Puts a line taken off back on its draft, with the change a phone made to it
 * meanwhile: the same line, its id and its history going on, and its receipt
 * from the history where no other comes (0022). Added again as any line is,
 * so a line from stock draws again, and one whose draft has gone out starts a
 * new draft for the client.
 */
export async function restoreLine(input: {
	lineId: string;
	fields: Record<string, string>;
	receipt: File | null;
	userId: string;
	madeAt?: string | null;
	/** Whoever is putting it back has Field, and puts back only a line they added. */
	field?: boolean;
}): Promise<Added> {
	const back = await db
		.selectFrom('invoice_line')
		.select('id')
		.where('id', '=', input.lineId)
		.executeTakeFirst();
	if (back) return { ok: true, id: back.id };
	const gone = await takenOff(input.lineId);
	if (!gone) return { ok: false, status: 404, detail: 'No line was ever taken off with that id.' };
	let was: Record<string, unknown> = {};
	try {
		was = JSON.parse(gone.was ?? '{}') as Record<string, unknown>;
	} catch {
		/* nothing to put back from */
	}
	if (input.field && str(was.created_by) !== input.userId) return notTheirs;
	// Its tax set by hand, as it was taken off with, where the change says
	// nothing of it; and someone with Field puts it back as it was.
	const before = formFieldsOf(was, await moneyPlaces());
	const tax = byHandFor(input.fields, before, input.field);
	if ('ok' in tax) return tax;
	const hex = str(was.receipt);
	// The type as the line's own column held it, which is what its history wrote.
	const kept =
		hex.startsWith('\\x') && was.receipt_type
			? { bytes: Buffer.from(hex.slice(2), 'hex'), type: str(was.receipt_type) as ReceiptType }
			: null;
	return addLine({
		id: input.lineId,
		invoiceId: str(was.invoice_id),
		clientUuid: str(was.client_uuid) || crypto.randomUUID(),
		fields: {
			...input.fields,
			...byHandSaid(input.fields, before),
			kind: str(was.kind),
			material_id: str(was.material_id)
		},
		receipt: input.receipt,
		kept,
		userId: input.userId,
		madeAt: input.madeAt
	});
}
