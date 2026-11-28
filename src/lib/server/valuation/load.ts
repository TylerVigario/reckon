/**
 * Loading what the valuation needs, so a page asks for entries and gets them
 * valued without knowing what that took.
 */
import { expressionBuilder, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/database.ts';
import { type Reader } from '../db/index.ts';
import {
	agreementFor,
	worth,
	type Agreement,
	type Context,
	type Entry,
	type Worth
} from './entries.ts';
import type { ServiceTerms } from './pricing.ts';
import type { Decimal } from '#lib/decimal.ts';
import { periodOn, type AgreementPeriod } from '#lib/agreement-periods.ts';
import { legVehiclePay, legWorth } from './misc.ts';
import { moneyPlaces } from '../business.ts';
import { TAX_ROUNDING } from '../tax-rules.ts';
import { invoiceTax, type InvoiceTax } from './tax.ts';

const te = expressionBuilder<DB, 'time_entry'>();

/**
 * The columns of a time entry the valuation reads, from the unaliased
 * time_entry: `.select(entryColumns)`, or `.select([...entryColumns, ...])`
 * beside others.
 */
export const entryColumns = [
	'time_entry.id',
	'time_entry.entity_id as entityId',
	'time_entry.site_id as siteId',
	'time_entry.service_id as serviceId',
	'time_entry.worked_on as workedOn',
	'time_entry.seconds',
	'time_entry.billable',
	'time_entry.crew',
	'time_entry.worked_by as workedBy',
	// Who a team entry names (0023).
	te
		.selectFrom('time_entry_crew as c')
		.whereRef('c.time_entry_id', '=', 'time_entry.id')
		.select((eb) =>
			eb.fn
				.coalesce(
					eb.fn
						.agg<string[] | null>('array_agg', [eb.cast<string>('c.user_id', 'text')])
						.orderBy('c.user_id'),
					sql<string[]>`'{}'`
				)
				.as('ids')
		)
		.$asScalar()
		// An aggregate: always one row, so never null.
		.$notNull()
		.as('crewIds'),
	'time_entry.created_at as createdAt'
] as const;

/** Services, prices, pay rules and people: small tables, read whole. */
export async function loadCatalogue(r: Reader): Promise<Omit<Context, 'agreements' | 'places'>> {
	const [services, prices, rules, people] = await Promise.all([
		r
			.selectFrom('service')
			.select([
				'id',
				'unit',
				'bill_to_nearest_seconds as billToNearestSeconds',
				'minimum_charge as minimumCharge'
			])
			.execute(),
		r
			.selectFrom('service_price')
			.select([
				'service_id as serviceId',
				'entity_id as entityId',
				'rate',
				'additional_rate as additionalRate',
				'effective_from as effectiveFrom'
			])
			.execute(),
		r
			.selectFrom('pay_rule')
			.select([
				'service_id as serviceId',
				'role_id as roleId',
				'user_id as userId',
				'entity_id as entityId',
				'pays_for as paysFor',
				'method',
				'amount',
				'effective_from as effectiveFrom'
			])
			.execute(),
		r.selectFrom('user').select(['id', 'role_id as roleId', 'active']).execute()
	]);
	return {
		services: new Map<string, ServiceTerms>(services.map((s) => [s.id, s])),
		prices,
		rules,
		people
	};
}

/** Every agreement these clients hold, with what each covers and each period charged. */
export async function loadAgreements(
	r: Reader,
	entityIds: readonly string[]
): Promise<Agreement[]> {
	if (!entityIds.length) return [];
	return r
		.selectFrom('agreement')
		.select((eb) => [
			'agreement.id',
			'agreement.entity_id as entityId',
			'agreement.site_id as siteId',
			'agreement.starts_on as startsOn',
			'agreement.ends_on as endsOn',
			'agreement.billing_interval as interval',
			'agreement.billing_anchor_day as anchorDay',
			// Figures as text: a NUMERIC inside JSON would arrive as a JS number.
			jsonArrayFrom(
				eb
					.selectFrom('agreement_service as s')
					.select((eb) => [
						's.service_id as serviceId',
						's.allotment',
						eb.cast<string | null>('s.included_hours', 'text').as('includedHours'),
						's.overage'
					])
					.whereRef('s.agreement_id', '=', 'agreement.id')
			).as('services'),
			jsonArrayFrom(
				eb
					.selectFrom('agreement_period as p')
					.select((eb) => [
						'p.id',
						'p.period_start as periodStart',
						'p.period_end as periodEnd',
						eb.cast<string>('p.amount', 'text').as('amount'),
						'p.given'
					])
					.whereRef('p.agreement_id', '=', 'agreement.id')
			).as('periods')
		])
		.where('agreement.entity_id', '=', (eb) => eb.fn.any(eb.val(entityIds)))
		.orderBy('agreement.starts_on')
		.orderBy('agreement.id')
		.execute();
}

/**
 * The entries that fell under each agreement within its window, keyed by the
 * agreement: an agreement given no window has none. Every hour counts against
 * the agreement it falls under -- its site's, or its client's where the site
 * has none of its own -- billable or not: a meter shows use, not charge.
 * `agreements` must hold all of their clients' agreements, so the site's can
 * win over the client's.
 */
export async function fellUnder(
	r: Reader,
	agreements: readonly Agreement[],
	windows: ReadonlyMap<string, { start: string; end: string }>
): Promise<Map<string, Entry[]>> {
	const fell = new Map<string, Entry[]>();
	const ranges = agreements.flatMap((a) => {
		const w = windows.get(a.id);
		return w ? [{ entityId: a.entityId, ...w }] : [];
	});
	if (!ranges.length) return fell;
	const entries = await r
		.selectFrom('time_entry')
		.select(entryColumns)
		.where((eb) =>
			eb.or(
				ranges.map((x) =>
					eb.and([
						eb('time_entry.entity_id', '=', x.entityId),
						eb.between('time_entry.worked_on', x.start, x.end)
					])
				)
			)
		)
		.execute();
	for (const e of entries) {
		const hit = agreementFor(e, agreements);
		const w = hit ? windows.get(hit.a.id) : undefined;
		if (!hit || !w || e.workedOn < w.start || e.workedOn > w.end) continue;
		fell.set(hit.a.id, [...(fell.get(hit.a.id) ?? []), e]);
	}
	return fell;
}

/**
 * Seconds worked in the period under way of each of these agreements
 * (#lib/agreement-periods), by agreement and then by service. An agreement
 * with no period under way -- ended, or not started -- has none. Every hour
 * counts, as fellUnder counts it.
 */
export async function usedThisPeriod(
	r: Reader,
	agreements: readonly Agreement[],
	today: string
): Promise<Map<string, Map<string, number>>> {
	const windows = new Map<string, AgreementPeriod>();
	for (const a of agreements) {
		const p = periodOn(a, a.periods, today);
		if (p) windows.set(a.id, p);
	}
	const fell = await fellUnder(r, agreements, windows);
	const used = new Map<string, Map<string, number>>();
	for (const id of windows.keys()) {
		const by = new Map<string, number>();
		for (const e of fell.get(id) ?? []) by.set(e.serviceId, (by.get(e.serviceId) ?? 0) + e.seconds);
		used.set(id, by);
	}
	return used;
}

/**
 * The entries asked about, and every billable entry that shares a charged
 * period with one of them: a capped pool is drawn in the order the work was
 * done, so an entry's coverage depends on the others in its period.
 */
async function withPeers(r: Reader, entries: readonly Entry[], agreements: readonly Agreement[]) {
	const ranges: { entityId: string; from: string; to: string }[] = [];
	for (const a of agreements)
		for (const p of a.periods)
			if (
				entries.some(
					(e) =>
						e.entityId === a.entityId && p.periodStart <= e.workedOn && e.workedOn <= p.periodEnd
				)
			)
				ranges.push({ entityId: a.entityId, from: p.periodStart, to: p.periodEnd });
	if (!ranges.length) return entries;

	const peers = await r
		.selectFrom('time_entry')
		.select(entryColumns)
		.where('time_entry.billable', '=', true)
		.where((eb) =>
			eb.or(
				ranges.map((x) =>
					eb.and([
						eb('time_entry.entity_id', '=', x.entityId),
						eb.between('time_entry.worked_on', x.from, x.to)
					])
				)
			)
		)
		.execute();
	const all = new Map(entries.map((e) => [e.id, e]));
	for (const p of peers) if (!all.has(p.id)) all.set(p.id, p);
	return [...all.values()];
}

/** What each of these entries is worth. */
export async function valueEntries(
	r: Reader,
	entries: readonly Entry[]
): Promise<Map<string, Worth>> {
	if (!entries.length) return new Map();
	const entityIds = [
		...new Set(entries.map((e) => e.entityId).filter((x): x is string => x !== null))
	];
	const [catalogue, agreements, places] = await Promise.all([
		loadCatalogue(r),
		loadAgreements(r, entityIds),
		moneyPlaces()
	]);
	const all = await withPeers(r, entries, agreements);
	const valued = worth(all, { ...catalogue, agreements, places });
	const wanted = new Set(entries.map((e) => e.id));
	for (const id of valued.keys()) if (!wanted.has(id)) valued.delete(id);
	return valued;
}

/**
 * What each of these trip legs bills, at its service's price on the day it was
 * driven, and what it pays for the vehicle: `vehicleId` and `vehicleOwnerId` are
 * its trip's, and a leg given neither pays nobody known.
 */
export async function valueLegs(
	r: Reader,
	legs: readonly {
		id: string;
		serviceId: string | null;
		entityId: string | null;
		miles: string;
		travelledOn: string;
		vehicleId?: string | null;
		vehicleOwnerId?: string | null;
	}[]
): Promise<Map<string, ReturnType<typeof legWorth> & { paid: Decimal | null }>> {
	if (!legs.length) return new Map();
	const [{ services, prices, rules, people }, places] = await Promise.all([
		loadCatalogue(r),
		moneyPlaces()
	]);
	const payee = (id: string | null) =>
		id === null ? null : { id, roleId: people.find((p) => p.id === id)?.roleId ?? null };
	return new Map(
		legs.map((l) => {
			const w = legWorth(l, l.travelledOn, services, prices, places);
			const vehicle = l.vehicleId ? { owner: payee(l.vehicleOwnerId ?? null) } : null;
			const paid = legVehiclePay(l, w.billed, l.travelledOn, vehicle, rules, places);
			return [l.id, { ...w, paid }];
		})
	);
}

/**
 * The tax on each of these invoices, split by the pieces each line kept -- or,
 * given a `state`, on the lines taxed there alone, as its return counts them.
 */
export async function taxOfInvoices(
	r: Reader,
	invoiceIds: readonly string[],
	state?: string
): Promise<Map<string, InvoiceTax>> {
	if (!invoiceIds.length) return new Map();
	const lines = await r
		.selectFrom('invoice_line')
		.select([
			'invoice_id as invoiceId',
			'amount',
			'taxable',
			'tax_rate_pct as taxRatePct',
			'tax_jurisdiction as jurisdiction',
			'tax_pieces as pieces'
		])
		.where('invoice_id', '=', (eb) => eb.fn.any(eb.val([...invoiceIds])))
		.$if(state !== undefined, (qb) => qb.where('tax_state', '=', state!))
		.execute();
	return invoiceTax(lines, TAX_ROUNDING, await moneyPlaces());
}
