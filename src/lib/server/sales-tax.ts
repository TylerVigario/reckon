import { sql, type Expression, type NumericString } from 'kysely';
import { Decimal, sum } from '#lib/decimal.ts';
import { asUser, db } from './db/index.ts';
import { moneyPlaces } from './business.ts';
import { businessToday } from './calendar.ts';
import { pgError } from './field-errors.ts';
import { stateTaxes, TAX_ROUNDING } from './tax-rules.ts';
import { claimsResold } from './tax-registrations.ts';
import { taxOfInvoices } from './valuation/load.ts';
import { inLevelOrder } from './valuation/tax.ts';
import { periodKey, periodsTo, type FilingPeriod } from '../filing-periods.ts';
import { AUTHORITY, stateName, type State } from '../us-states.ts';
import type { TaxLevel } from './db/database.ts';
import type { PaymentFields, ReturnFields } from '../tax-filing-fields.ts';

/**
 * SALES TAX HELD, BY THE STATE IT IS OWED TO (20261127T0216Z): what was
 * collected there, and what has been filed and handed over.
 *
 * TAX CHARGED IS NOT INCOME. It is held for the state and then handed over, so
 * the figure that means anything is what is still held: the tax charged there
 * on what has gone out, less the Reg 1701 credit where the business claims it
 * -- tax already paid on goods resold -- less what its returns kept for filing
 * on time, less the tax handed over. Penalty and interest are the business's
 * own cost, not tax it collected, and bring nothing down. And it is what was
 * collected, not what a return said: tax collected beyond what is due goes
 * back to the customer or to the state (R&TC s. 6901.5), and is held until it
 * does.
 *
 * ACCRUAL, not cash: the tax is owed once the invoice goes out, not when the
 * client pays. That is the basis a sent invoice already implies.
 *
 * Every state is here that the business collects in, or has charged tax in,
 * or has filed or paid in -- one it no longer collects in keeps what was
 * collected there until it has been handed over. The home page's Sales tax
 * held is these added up, by this function, so the figure and the page it
 * opens cannot disagree.
 */

/** Refused, by the field it is about. */
export class Refused extends Error {
	constructor(
		readonly field: string,
		message: string
	) {
		super(message);
	}
}

export type Held = {
	state: string;
	collected: string;
	credit: string;
	kept: string;
	handedOver: string;
	penaltyAndInterest: string;
	held: string;
};

/** Every state with tax to say anything of, by its own name. */
function statesWithTax() {
	return db
		.selectFrom('tax_registration')
		.select('state')
		.union(
			db
				.selectFrom('invoice_line as il')
				.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
				.select(sql<string>`il.tax_state`.as('state'))
				.where('i.status', '=', 'sent')
				.where('il.tax_state', 'is not', null)
		)
		.union(db.selectFrom('tax_return').select('state'))
		.union(db.selectFrom('tax_payment').select('state'));
}

const byName = <T extends { state: string }>(xs: T[]) =>
	xs.sort((a, b) => stateName(a.state).localeCompare(stateName(b.state)));

/** What each state is owed, collected and handed over: one row a state. */
export async function heldByState(): Promise<Held[]> {
	const places = await moneyPlaces();
	const at = (v: Expression<unknown>) =>
		sql<string>`round(coalesce(${v}, 0), ${places}::int)::text`;
	const rows = await db
		.selectFrom(statesWithTax().as('s'))
		.select((eb) => [
			's.state',
			at(
				eb
					.selectFrom(stateTaxes(TAX_ROUNDING, places).as('t'))
					.innerJoin('invoice as i', 'i.id', 't.invoice_id')
					.select((eb) => eb.fn.sum<NumericString>('t.tax').as('v'))
					.where('i.status', '=', 'sent')
					.whereRef('t.state', '=', 's.state')
					.$asScalar()
			).as('collected'),
			// Reg 1701, as the return takes it off: only where it is claimed.
			at(
				eb
					.selectFrom('invoice_line as il')
					.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
					.select((eb) =>
						sql<NumericString>`sum(${eb.ref('il.ex_tax_cost')} * ${eb.ref('il.tax_rate_pct')} / 100)`.as(
							'v'
						)
					)
					.where('i.status', '=', 'sent')
					.where('il.taxable', '=', true)
					.whereRef('il.tax_state', '=', 's.state')
					.where((eb) => claimsResold(eb.ref('il.tax_state')))
					.$asScalar()
			).as('credit'),
			// What each period's return, as it stands, kept.
			at(
				eb
					.selectFrom('tax_return as r')
					.select((eb) => eb.fn.sum<NumericString>('r.kept').as('v'))
					.whereRef('r.state', '=', 's.state')
					.where((eb) =>
						eb.not(
							eb.exists(
								eb.selectFrom('tax_return as a').select('a.id').whereRef('a.amends', '=', 'r.id')
							)
						)
					)
					.$asScalar()
			).as('kept'),
			at(
				eb
					.selectFrom('tax_payment as p')
					.select((eb) => eb.fn.sum<NumericString>('p.tax').as('v'))
					.whereRef('p.state', '=', 's.state')
					.$asScalar()
			).as('handed_over'),
			at(
				eb
					.selectFrom('tax_payment as p')
					.select((eb) => eb.fn.sum<NumericString>('p.penalty_and_interest').as('v'))
					.whereRef('p.state', '=', 's.state')
					.$asScalar()
			).as('penalty_and_interest')
		])
		.execute();
	return byName(
		rows.map((r) => ({
			state: r.state,
			collected: r.collected,
			credit: r.credit,
			kept: r.kept,
			handedOver: r.handed_over,
			penaltyAndInterest: r.penalty_and_interest,
			held: Decimal.from(r.collected).sub(r.credit).sub(r.kept).sub(r.handed_over).toFixed(places)
		}))
	);
}

/** What is still held, every state's added up: the home page's figure. */
export async function taxHeld(): Promise<string> {
	const [held, places] = await Promise.all([heldByState(), moneyPlaces()]);
	return sum(held.map((h) => h.held)).toFixed(places);
}

export type Filed = {
	id: string;
	filed_on: string;
	tax: string;
	kept: string;
	reference: string | null;
	/** Another return filed for its period since, correcting it. */
	amended: boolean;
};

export type Paid = {
	id: string;
	paid_on: string;
	tax: string;
	penalty_and_interest: string;
	reference: string | null;
};

export type PeriodFiled = FilingPeriod & {
	/** Its returns, the one that stands last; none where nothing is filed yet. */
	returns: Filed[];
	payments: Paid[];
	/** What the return that stands leaves owing, or null where none is filed. */
	owing: string | null;
};

export type Collected = {
	charged: string;
	/** Who levied what was charged: federal, then state, then local, each by name. */
	levied: { level: TaxLevel; jurisdiction: string; kind: string | null; amount: string }[];
};

/** What a state was charged on `invoiceIds`, and who levied it, as each line kept it. */
export async function chargedOn(invoiceIds: readonly string[], state: string): Promise<Collected> {
	const places = await moneyPlaces();
	const taxes = [...(await taxOfInvoices(db, invoiceIds, state)).values()];
	return {
		charged: sum(taxes.map((x) => x.tax)).toFixed(places),
		levied: [
			...Map.groupBy(
				taxes.flatMap((x) => x.levied),
				(p) => `${p.level} ${p.jurisdiction} ${p.kind ?? ''}`
			).values()
		]
			.map((ps) => ({
				level: ps[0].level,
				jurisdiction: ps[0].jurisdiction,
				kind: ps[0].kind ?? null,
				amount: sum(ps.map((p) => p.tax)).toFixed(places)
			}))
			.sort(inLevelOrder)
	};
}

export type StateTax = Held & {
	/** Who levied what was collected there. */
	levied: Collected['levied'];
	/** Each period filed or paid, the latest first. */
	periods: PeriodFiled[];
};

/** A state's periods, each with its returns and payments. */
async function periodsOf(state: string, places: number): Promise<PeriodFiled[]> {
	const [returns, payments] = await Promise.all([
		db
			.selectFrom('tax_return as r')
			.select((eb) => [
				'r.id',
				'r.period_start',
				'r.period_end',
				'r.filed_on',
				'r.tax',
				'r.kept',
				'r.reference',
				eb
					.exists(eb.selectFrom('tax_return as a').select('a.id').whereRef('a.amends', '=', 'r.id'))
					.$castTo<boolean>()
					.as('amended')
			])
			.where('r.state', '=', state)
			.orderBy('r.filed_on')
			.orderBy('r.id')
			.execute(),
		db
			.selectFrom('tax_payment')
			.select([
				'id',
				'period_start',
				'period_end',
				'paid_on',
				'tax',
				'penalty_and_interest',
				'reference'
			])
			.where('state', '=', state)
			.orderBy('paid_on')
			.orderBy('id')
			.execute()
	]);
	const periods = new Map<string, PeriodFiled>();
	const of = (p: FilingPeriod) => {
		const key = periodKey(p);
		if (!periods.has(key))
			periods.set(key, { start: p.start, end: p.end, returns: [], payments: [], owing: null });
		return periods.get(key)!;
	};
	for (const r of returns)
		of({ start: r.period_start, end: r.period_end }).returns.push({
			id: r.id,
			filed_on: r.filed_on,
			tax: r.tax,
			kept: r.kept,
			reference: r.reference,
			amended: r.amended
		});
	for (const p of payments)
		of({ start: p.period_start, end: p.period_end }).payments.push({
			id: p.id,
			paid_on: p.paid_on,
			tax: p.tax,
			penalty_and_interest: p.penalty_and_interest,
			reference: p.reference
		});
	for (const p of periods.values()) {
		// The return that stands, which no other corrects, after those it does.
		p.returns.sort((a, b) => Number(a.amended === false) - Number(b.amended === false));
		const stands = p.returns.find((r) => !r.amended);
		if (stands)
			p.owing = Decimal.from(stands.tax)
				.sub(stands.kept)
				.sub(sum(p.payments.map((x) => x.tax)))
				.toFixed(places);
	}
	return [...periods.values()].sort((a, b) => b.start.localeCompare(a.start));
}

/** Each state's tax, held and filed: the Sales tax report. */
export async function salesTax(): Promise<StateTax[]> {
	const [held, places] = await Promise.all([heldByState(), moneyPlaces()]);
	return Promise.all(
		held.map(async (h) => {
			const sent = await db
				.selectFrom('invoice as i')
				.select('i.id')
				.where('i.status', '=', 'sent')
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom('invoice_line as il')
							.select('il.id')
							.whereRef('il.invoice_id', '=', 'i.id')
							.where('il.tax_state', '=', h.state)
					)
				)
				.execute();
			const { levied } = await chargedOn(
				sent.map((s) => s.id),
				h.state
			);
			return { ...h, levied, periods: await periodsOf(h.state, places) };
		})
	);
}

/**
 * What was collected for each of `periods` in a state -- the tax on what went
 * out in it, by the day each invoice was dated -- and the Reg 1701 credit
 * where it is claimed: what a return for it would say, as reckon has it.
 */
export async function collectedFor(
	state: string,
	periods: readonly FilingPeriod[]
): Promise<Record<string, { collected: string; credit: string }>> {
	if (!periods.length) return {};
	const places = await moneyPlaces();
	const at = (v: Expression<unknown>) =>
		sql<string>`round(coalesce(${v}, 0), ${places}::int)::text`;
	const rows = await Promise.all(
		periods.map((p) =>
			db
				.selectNoFrom((eb) => [
					at(
						eb
							.selectFrom(stateTaxes(TAX_ROUNDING, places).as('t'))
							.innerJoin('invoice as i', 'i.id', 't.invoice_id')
							.select((eb) => eb.fn.sum<NumericString>('t.tax').as('v'))
							.where('i.status', '=', 'sent')
							.where('t.state', '=', state)
							.where((eb) => eb.between('i.issued_on', p.start, p.end))
							.$asScalar()
					).as('collected'),
					at(
						eb
							.selectFrom('invoice_line as il')
							.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
							.select((eb) =>
								sql<NumericString>`sum(${eb.ref('il.ex_tax_cost')} * ${eb.ref('il.tax_rate_pct')} / 100)`.as(
									'v'
								)
							)
							.where('i.status', '=', 'sent')
							.where('il.taxable', '=', true)
							.where('il.tax_state', '=', state)
							.where((eb) => eb.between('i.issued_on', p.start, p.end))
							.where((eb) => claimsResold(eb.ref('il.tax_state')))
							.$asScalar()
					).as('credit')
				])
				.executeTakeFirstOrThrow()
		)
	);
	return Object.fromEntries(periods.map((p, i) => [periodKey(p), rows[i]]));
}

export type PeriodChoice = FilingPeriod & {
	/** What was collected for it, and the Reg 1701 credit off that. */
	collected: string;
	credit: string;
	/** The day its return that stands was filed, or null where none is. */
	filedOn: string | null;
	/** The tax paid for it so far. */
	paid: string;
	/** What its return leaves owing, or null where none is filed. */
	owing: string | null;
};

/** How many of a state's latest periods a form offers, by how often it files. */
const OFFERED = { monthly: 12, quarterly: 8, annual: 3 } as const;

/**
 * The periods a return or a payment for a state can be for, by how often the
 * business files there (#lib/filing-periods): those ended, the latest first,
 * and with `current` the one under way first, as a prepayment is for. None
 * where it has not said how often, or no longer collects there; the form
 * takes the days instead.
 */
export async function periodChoices(
	state: string,
	{ current }: { current: boolean }
): Promise<PeriodChoice[]> {
	const [reg, op, places] = await Promise.all([
		db
			.selectFrom('tax_registration')
			.select('filing_basis')
			.where('state', '=', state)
			.executeTakeFirst(),
		db.selectFrom('operator').select('fiscal_year_end_month').executeTakeFirst(),
		moneyPlaces()
	]);
	const basis = reg?.filing_basis;
	if (!basis) return [];
	const periods = periodsTo(
		businessToday(),
		basis,
		op?.fiscal_year_end_month ?? null,
		OFFERED[basis],
		current
	);
	const [figures, filed] = await Promise.all([
		collectedFor(state, periods),
		periodsOf(state, places)
	]);
	const byKey = new Map(filed.map((p) => [periodKey(p), p]));
	return periods.map((p) => {
		const f = byKey.get(periodKey(p));
		return {
			...p,
			...figures[periodKey(p)],
			filedOn: f?.returns.find((r) => !r.amended)?.filed_on ?? null,
			paid: sum((f?.payments ?? []).map((x) => x.tax)).toFixed(places),
			owing: f?.owing ?? null
		};
	});
}

/**
 * What a form recording a return or a payment for a state starts from: who it
 * is filed with, and its periods (periodChoices). Null where there is no tax
 * there to file for.
 */
export async function filingIn(state: string, { current }: { current: boolean }) {
	if (!(await statesToFile()).includes(state)) return null;
	const [reg, periods] = await Promise.all([
		db
			.selectFrom('tax_registration')
			.select('agency')
			.where('state', '=', state)
			.executeTakeFirst(),
		periodChoices(state, { current })
	]);
	return { state, agency: reg?.agency ?? AUTHORITY[state as State]?.short ?? null, periods };
}

/** The states a return or a payment can be recorded for. */
export async function statesToFile(): Promise<string[]> {
	return byName(await statesWithTax().execute()).map((s) => s.state);
}

async function refuseUnknown(state: string) {
	if (!(await statesToFile()).includes(state))
		throw new Refused(
			'state',
			`Nothing is collected in ${stateName(state)}, so there is nothing to hand over there.`
		);
}

/** The database's refusals, said by the field each is about. */
function said(e: unknown, state: string): never {
	switch (pgError(e).constraint) {
		case 'a_state_s_periods_do_not_overlap':
			throw new Refused(
				'period_start',
				`It overlaps another period recorded for ${stateName(state)}. Each return or payment there is for one of its periods.`
			);
		case 'a_state_files_a_period_once':
		case 'tax_return_amends_key':
			throw new Refused(
				'period_start',
				'Another return for that period was recorded meanwhile. Look again, then record it.'
			);
		case 'a_return_is_filed_once_its_period_ends':
			throw new Refused('filed_on', 'Filed once its period ends.');
		case 'what_is_kept_is_of_the_tax':
			throw new Refused('kept', 'No more than the tax on the return.');
	}
	throw e;
}

/**
 * Records a return filed with a state, and what was paid with it, as a payment
 * of its own on the day. One for a period with a return already is the
 * amended return: it stands in that one's place.
 */
export async function recordReturn(
	userId: string,
	state: string,
	x: ReturnFields
): Promise<string> {
	await refuseUnknown(state);
	try {
		return await asUser(userId, async (tx) => {
			const stands = await tx
				.selectFrom('tax_return as r')
				.select('r.id')
				.where('r.state', '=', state)
				.where('r.period_start', '=', x.period_start)
				.where('r.period_end', '=', x.period_end)
				.where((eb) =>
					eb.not(
						eb.exists(
							eb.selectFrom('tax_return as a').select('a.id').whereRef('a.amends', '=', 'r.id')
						)
					)
				)
				.executeTakeFirst();
			const { id } = await tx
				.insertInto('tax_return')
				.values({
					state,
					period_start: x.period_start,
					period_end: x.period_end,
					filed_on: x.filed_on,
					tax: x.tax,
					kept: x.kept,
					reference: x.reference,
					amends: stands?.id ?? null
				})
				.returning('id')
				.executeTakeFirstOrThrow();
			if (Decimal.from(x.paid).gt('0'))
				await tx
					.insertInto('tax_payment')
					.values({
						state,
						period_start: x.period_start,
						period_end: x.period_end,
						paid_on: x.filed_on,
						tax: x.paid,
						reference: x.reference
					})
					.execute();
			return id;
		});
	} catch (e) {
		said(e, state);
	}
}

/** Records a payment to a state: with its period's return, after it, or before it. */
export async function recordPayment(
	userId: string,
	state: string,
	x: PaymentFields
): Promise<string> {
	await refuseUnknown(state);
	try {
		return await asUser(userId, async (tx) => {
			const { id } = await tx
				.insertInto('tax_payment')
				.values({
					state,
					period_start: x.period_start,
					period_end: x.period_end,
					paid_on: x.paid_on,
					tax: x.tax,
					penalty_and_interest: x.penalty_and_interest,
					reference: x.reference
				})
				.returning('id')
				.executeTakeFirstOrThrow();
			return id;
		});
	} catch (e) {
		said(e, state);
	}
}

/**
 * Takes off a return recorded by mistake: its history keeps what it was. One
 * an amended return corrects stays until that one is taken off. False where
 * the state has no such return.
 */
export async function removeReturn(userId: string, state: string, id: string) {
	try {
		return await asUser(userId, async (tx) => {
			const gone = await tx
				.deleteFrom('tax_return')
				.where('id', '=', id)
				.where('state', '=', state)
				.returning('id')
				.executeTakeFirst();
			return gone !== undefined;
		});
	} catch (e) {
		if (pgError(e).constraint === 'tax_return_amends_fkey')
			throw new Refused('return', 'An amended return corrects it. Take that one off first.');
		throw e;
	}
}

/** Takes off a payment recorded by mistake. False where the state has no such payment. */
export async function removePayment(userId: string, state: string, id: string) {
	return asUser(userId, async (tx) => {
		const gone = await tx
			.deleteFrom('tax_payment')
			.where('id', '=', id)
			.where('state', '=', state)
			.returning('id')
			.executeTakeFirst();
		return gone !== undefined;
	});
}
