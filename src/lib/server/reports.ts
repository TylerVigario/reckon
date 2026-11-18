import { sql, type NotNull, type NumericString } from 'kysely';
import { Decimal, sum, sumMoney } from '#lib/decimal.ts';
import { db } from './db/index.ts';
import { businessToday } from './calendar.ts';
import { moneyPlaces } from './business.ts';
import type { Period } from './periods.ts';
import { agreementFor, team } from './valuation/entries.ts';
import {
	entryColumns,
	loadAgreements,
	loadCatalogue,
	taxOfInvoices,
	valueEntries,
	valueLegs
} from './valuation/load.ts';
import { billedAmount, jobRate, priceOn } from './valuation/pricing.ts';
import { ruleOn, timePay } from './valuation/pay.ts';
import { lastConfirmed, rateIsStale } from './stale.ts';
import type { TaxLevel } from './db/database.ts';
import type { TaxPiece } from './db/tax-pieces.ts';
import { inLevelOrder } from './valuation/tax.ts';
import { dated, daysAgo, names } from '#lib/format.ts';
import { crewNames } from './choices.ts';
import { townsOf } from './trips.ts';
import { owed, recordedFor } from './pay.ts';
import { PAID_AS_ORDER, type PaidAs } from '#lib/pay-words.ts';
import { Ratio } from '#lib/decimal.ts';

/**
 * The three things somebody outside the business asks for, and the one thing
 * the business asks itself.
 *
 * None of these is a report in the usual sense -- each is the same data grouped
 * the way a return, a payroll, or a retainer needs it. They live here rather
 * than in one page because the index shows each one's headline figure beside
 * the link to it, and a headline computed differently from the page it links to
 * is a bug that takes a year to find.
 *
 * Money is NUMERIC throughout: a string out of Postgres, and worked with through
 * #lib/decimal, never a JS number.
 */

export type DistrictRow = {
	area: string;
	rate_pct: string | null;
	/** Who levied the rate, as a line taxed there kept it. */
	pieces: TaxPiece[] | null;
	measure: string;
	deduction: string;
	net: string;
	tax: string;
	lines: number;
	sites: number;
};

export type ScheduleA = {
	districts: DistrictRow[];
	due: string;
	claimsResold: boolean;
	/** Each opens its site, where CDTFA is asked again: `at` is its route's params. */
	unchecked: { site: string; client: string; why: string; at: { id: string; site: string } }[];
	overrides: { invoice: string; description: string; rate_pct: string; reason: string | null }[];
};

/**
 * Schedule A: the measure and the deduction, by the CDTFA area the work
 * happened in. California's return, so of the lines taxed in California alone.
 *
 * BY JURISDICTION, NOT BY DISTRICT. The rate API answers with one combined
 * rate per address and the area's name -- it does not decompose into the
 * districts making it up. Breaking out further would mean keeping a local
 * table of districts -- a second copy of CDTFA's data, and a copy nobody
 * refreshes is a rate that goes stale.
 *
 * DISTRICT TAX FOLLOWS THE JOBSITE, not the billing address -- Reg 1826 puts
 * the place of use of materials at the jobsite, and the jobsite is the place of
 * sale of a fixture. So every line is grouped by the area of the SITE on the
 * line, never by anything on the client.
 *
 * AS IT WAS BILLED. Each line is grouped by the area it kept from its site, at
 * the rate it was taxed at (0030), never by the site as it is now: a rate
 * refreshed or an address chosen again after a period was filed leaves the
 * period as it was, and a site no longer in use keeps its sales in it. An area
 * whose rate changed within the period is two rows, one to each rate.
 *
 * A California site whose rate has not been confirmed this quarter is listed
 * by name. The rate on file is not wrong, but it is not known to be right
 * either, and a district added or ended in between would have been charged
 * wrongly ever since. So is one in no area yet, where nothing can be taxed.
 */
export async function scheduleA(p: Period): Promise<ScheduleA> {
	const [registered, places] = await Promise.all([
		db
			.selectFrom('tax_registration')
			.select('claims_tax_paid_purchases_resold as claims')
			.where('state', '=', 'CA')
			.executeTakeFirst(),
		moneyPlaces()
	]);
	const claims = registered?.claims ?? false;
	const today = businessToday();

	const districts: DistrictRow[] = await db
		.selectFrom('invoice_line as il')
		.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
		.select((eb) => {
			const measure = eb.fn.sum<NumericString>('il.amount');
			// Reg 1701: tax already paid on goods that were resold comes off
			// the measure, and only if the operator has made that election.
			const deduction = eb
				.case()
				.when(eb.val(claims))
				.then(eb.fn.coalesce(eb.fn.sum<NumericString>('il.ex_tax_cost'), eb.lit(0)))
				.else(eb.lit(0))
				.end();
			const net = sql`${measure} - ${deduction}`;
			return [
				'il.tax_jurisdiction as area',
				eb.cast<string>('il.tax_rate_pct', 'text').as('rate_pct'),
				// Who levied it, as a line taxed there kept it when it was added.
				eb.fn
					.agg<TaxPiece[] | null>('any_value', ['il.tax_pieces'])
					.filterWhere('il.tax_pieces', 'is not', null)
					.as('pieces'),
				sql<string>`round(${measure}, ${places}::int)::text`.as('measure'),
				sql<string>`round(${deduction}, ${places}::int)::text`.as('deduction'),
				sql<string>`round(${net}, ${places}::int)::text`.as('net'),
				sql<string>`round((${net}) * ${eb.ref('il.tax_rate_pct')} / 100, ${places}::int)::text`.as(
					'tax'
				),
				eb.cast<number>(eb.fn.countAll(), 'integer').as('lines'),
				eb.cast<number>(eb.fn.count('il.site_id').distinct(), 'integer').as('sites')
			];
		})
		.where('i.status', '=', 'sent')
		.where((eb) => eb.between('i.issued_on', p.start, p.end))
		.where('il.tax_state', '=', 'CA')
		.$narrowType<{ area: NotNull }>()
		.groupBy(['il.tax_jurisdiction', 'il.tax_rate_pct'])
		.orderBy('il.tax_jurisdiction')
		.orderBy('il.tax_rate_pct')
		.execute();

	// A California site in no area yet, or whose rate is not known to be right
	// this quarter.
	const stale = await db
		.selectFrom('site')
		.innerJoin('entity', 'entity.id', 'site.entity_id')
		.leftJoin('tax_area', 'tax_area.id', 'site.tax_area_id')
		.select((eb) => {
			const confirmed = lastConfirmed(
				eb.ref('site.area_verified_on'),
				eb.ref('tax_area.confirmed_on')
			);
			return [
				'site.display as site',
				'entity.name as client',
				'entity.slug as client_slug',
				'site.slug as site_slug',
				eb.cast<string | null>(confirmed, 'text').as('priced_on'),
				sql<number | null>`${today}::date - ${confirmed}`.as('days')
			];
		})
		.where('site.active', '=', true)
		.where('site.region', '=', 'CA')
		.where((eb) =>
			eb.or([
				eb('tax_area.id', 'is', null),
				rateIsStale(
					lastConfirmed(eb.ref('site.area_verified_on'), eb.ref('tax_area.confirmed_on')),
					today
				)
			])
		)
		.$narrowType<{ site: NotNull }>()
		.orderBy('priced_on')
		.orderBy('entity.name')
		.orderBy('site.display')
		.execute();

	// A rate that did not come from the site is never folded into an area.
	// It is shown on its own, with the reason it was overridden.
	const overrides = await db
		.selectFrom('invoice_line as il')
		.innerJoin('invoice as i', 'i.id', 'il.invoice_id')
		.select([
			'i.number as invoice',
			'il.description',
			'il.tax_rate_pct as rate_pct',
			'il.tax_override_reason as reason'
		])
		.where('i.status', '=', 'sent')
		.where((eb) => eb.between('i.issued_on', p.start, p.end))
		.where('il.tax_source', '=', 'override')
		.where('il.tax_state', '=', 'CA')
		.orderBy('i.number')
		.orderBy('il.seq')
		.execute();

	return {
		districts,
		due: sumMoney(
			districts.map((d) => d.tax),
			places
		),
		claimsResold: claims,
		unchecked: stale.map(({ site, client, priced_on, days, client_slug, site_slug }) => ({
			site,
			client,
			why:
				priced_on === null
					? 'In no tax area yet'
					: `Last confirmed ${dated(priced_on)}, ${daysAgo(days!)}`,
			at: { id: client_slug, site: site_slug }
		})),
		overrides
	};
}

export type Obligation = {
	charged: string;
	/** Who levied what was charged: federal, then state, then local, each by name. */
	levied: { level: TaxLevel; jurisdiction: string; amount: string }[];
	remitted: string;
	outstanding: string;
	filings: {
		id: string;
		period_start: string;
		period_end: string;
		filed_on: string | null;
		paid_on: string | null;
		amount: string;
		reference: string | null;
	}[];
};

/**
 * What was collected on somebody else's behalf in one state, what has been
 * handed over to it, and the difference.
 *
 * TAX CHARGED IS NOT INCOME. It is held briefly and then passed on, so the
 * only figure that means anything is what is still held -- and that cannot be
 * derived from invoices alone, because whether a return was paid is a fact
 * about the world. tax_remittance records it; this subtracts.
 *
 * ACCRUAL, not cash: the obligation arises when the invoice is raised, not
 * when the client pays. That is the basis a sent invoice already implies, and
 * billing a client for tax while claiming not to owe it yet is the position
 * that goes wrong under audit.
 */
export async function taxObligation(p: Period, state: string): Promise<Obligation> {
	const places = await moneyPlaces();
	const raised = await db
		.selectFrom('invoice')
		.select('id')
		.where('status', '=', 'sent')
		.where((eb) => eb.between('issued_on', p.start, p.end))
		.execute();
	const taxes = [
		...(
			await taxOfInvoices(
				db,
				raised.map((r) => r.id),
				state
			)
		).values()
	];

	const filings = await db
		.selectFrom('tax_remittance')
		.select(['id', 'period_start', 'period_end', 'filed_on', 'paid_on', 'amount', 'reference'])
		.where('state', '=', state)
		.where('period_start', '<=', p.end)
		.where('period_end', '>=', p.start)
		.orderBy('period_start')
		.execute();

	const charged = sum(taxes.map((x) => x.tax));
	const remitted = sum(filings.map((f) => f.amount));
	return {
		charged: charged.toFixed(places),
		levied: [
			...Map.groupBy(
				taxes.flatMap((x) => x.levied),
				(p) => `${p.level} ${p.jurisdiction}`
			).values()
		]
			.map((ps) => ({
				level: ps[0].level,
				jurisdiction: ps[0].jurisdiction,
				amount: sum(ps.map((p) => p.tax)).toFixed(places)
			}))
			.sort(inLevelOrder),
		remitted: remitted.toFixed(places),
		outstanding: charged.sub(remitted).toFixed(places),
		filings
	};
}

/** Who was paid for a job or a trip, and the day (0026). */
export type PaidBy = { who: string; paid_on: string };

export type PayJob = {
	job: string;
	worked_on: string;
	crew: string;
	who: string | null;
	heads: number;
	hours: string;
	earned: string | null;
	paid: string | null;
	kept: string | null;
	/** Of `paid`, what payments recorded, at the figure they recorded. */
	recorded: string | null;
	paid_by: PaidBy[];
};

/** A person's pay: what they are owed now, and their last payment. */
export type PersonOwed = {
	id: string;
	name: string;
	role: string | null;
	/** What their role says its pay is (0027); null where it has not said, or they hold none. */
	pays_as: PaidAs | null;
	owed: string;
	/** Of `owed`, what is for their work, and what pays back their vehicle. */
	owed_work: string;
	owed_vehicle: string;
	/** Pieces of their work no rule pays: owed, at a figure nobody can say. */
	unknown: number;
	last: { paid_on: string; total: string; how: string } | null;
};

/** A trip's miles, and what they paid the vehicle they were driven in. */
export type PayTrip = {
	trip_id: string;
	job: string;
	worked_on: string;
	vehicle: string | null;
	/** Whose the vehicle is; null for the business's, or for none recorded. */
	owner: string | null;
	miles: string;
	earned: string | null;
	paid: string | null;
	kept: string | null;
	recorded: string | null;
	paid_by: PaidBy[];
};

export type PayOwed = {
	people: PersonOwed[];
	jobs: PayJob[];
	trips: PayTrip[];
	/** What payments recorded, of what is due. */
	recorded: string;
	due: string;
	/** `due`, by what it pays; null for pay whose role has not said. */
	due_as: { paid_as: PaidAs | null; amount: string }[];
	kept: string;
	rates: HourNow[];
};

/** Added up, leaving out the unknown; null when every part is unknown. */
const sumKnown = (xs: (Decimal | null)[]) => {
	const known = xs.filter((x): x is Decimal => x !== null);
	return known.length ? sum(known) : null;
};

/**
 * What the business owes its people for a month's work, resolved per job per day.
 *
 * Every figure is the valuation's: each entry priced and paid by the price and
 * the rules in force ON THE DAY it was worked, not today's. Re-pricing August
 * at September's rates is how somebody gets paid the wrong figure and nobody
 * can say why. A job's figures are the sum of its entries'.
 *
 * What a job EARNED is what it bills by the hour plus, for hours a retainer
 * covered, its share of what the retainer charged -- so a covered job is not a
 * job that brought in nothing. Pay is per head: a team entry pays everybody on
 * it, each by their own rule, so subtracting it gives what the business keeps.
 */
export async function payOwed(p: Period): Promise<PayOwed> {
	const places = await moneyPlaces();
	const entries = await db
		.selectFrom('time_entry')
		.innerJoin('entity', 'entity.id', 'time_entry.entity_id')
		.leftJoin('site', 'site.id', 'time_entry.site_id')
		.leftJoin('user', 'user.id', 'time_entry.worked_by')
		.select((eb) => [
			...entryColumns,
			eb.fn.coalesce('site.display', 'entity.name').as('place'),
			'user.name as who',
			crewNames(eb.ref('time_entry.id')).as('teamNames')
		])
		.where('time_entry.billable', '=', true)
		.where((eb) => eb.between('time_entry.worked_on', p.start, p.end))
		// In the order the work was done, so jobs of one day and place keep it.
		.orderBy('time_entry.worked_on')
		.orderBy('time_entry.started_at')
		.orderBy('time_entry.created_at')
		.orderBy('time_entry.id')
		.execute();
	const worth = await valueEntries(db, entries);
	// What payments recorded for this work: paid at that figure, whatever the
	// rules say now (0026).
	const [recorded, firstNames] = await Promise.all([
		recordedFor(
			entries.map((e) => e.id),
			[]
		),
		db
			.selectFrom('user')
			.leftJoin('role', 'role.id', 'user.role_id')
			.select(['user.id', 'user.name', 'role.pays_as'])
			.execute()
	]);
	const first = new Map(firstNames.map((u) => [u.id, u.name.split(' ')[0]]));
	// What the month's pay is: as a payment recorded it, or as the person's role
	// says now (0027).
	const paysAs = new Map(firstNames.map((u) => [u.id, u.pays_as]));
	const dueAs = new Map<PaidAs | null, Decimal>();
	const owe = (as: PaidAs | null, v: Decimal | null) =>
		v && !v.isZero() && dueAs.set(as, (dueAs.get(as) ?? Decimal.ZERO).add(v));

	// One row per job per day. What makes it one job is everything that prices
	// it: the client, the place, the service, and who worked it -- one person, or
	// the crew a team entry names. Two of those differing is two jobs, however
	// near each other they happened.
	const groups = new Map<string, typeof entries>();
	for (const e of entries) {
		const key = [
			e.place,
			e.workedOn,
			e.crew,
			e.teamNames.join(','),
			e.who,
			e.serviceId,
			e.entityId,
			e.workedBy
		].join('\u0000');
		groups.set(key, [...(groups.get(key) ?? []), e]);
	}
	const jobs: PayJob[] = [...groups.values()].map((es) => {
		const w = es.map((e) => worth.get(e.id)!);
		const earned = sumKnown(w.map((x) => x.earned));
		// Each person's pay on each entry: as a payment recorded it, or as it
		// works out now.
		const shares = es.flatMap((e) =>
			worth.get(e.id)!.people.map((p) => ({
				live: p.paid,
				kept: recorded.get(`${p.userId}:${e.id}`),
				userId: p.userId
			}))
		);
		for (const x of shares)
			owe(x.kept?.paidAs ?? paysAs.get(x.userId) ?? null, x.kept?.amount ?? x.live);
		const paid = sumKnown(shares.map((x) => x.kept?.amount ?? x.live));
		const kept = shares.filter((x) => x.kept).map((x) => x.kept!);
		return {
			job: es[0].place,
			worked_on: es[0].workedOn,
			crew: es[0].crew,
			who: es[0].crew === 'team' ? names(es[0].teamNames) : es[0].who,
			heads: Math.max(...w.map((x) => x.heads)),
			hours: Ratio.of(es.reduce((n, e) => n + e.seconds, 0))
				.div(3600)
				.round(4)
				.toString(),
			earned: earned?.toFixed(places) ?? null,
			paid: paid?.toFixed(places) ?? null,
			kept: earned && paid ? earned.sub(paid).toFixed(places) : null,
			recorded: kept.length ? sum(kept.map((k) => k.amount)).toFixed(places) : null,
			paid_by: paidBy(kept, first)
		};
	});
	jobs.sort((a, b) => a.worked_on.localeCompare(b.worked_on) || a.job.localeCompare(b.job));
	const trips = await tripsPaid(p, places, first);
	for (const x of trips) owe('reimbursement', x.paid === null ? null : Decimal.from(x.paid));

	return {
		people: await peopleOwed(places),
		jobs,
		trips,
		recorded: sumMoney(
			[...jobs, ...trips].map((j) => j.recorded),
			places
		),
		due: sumMoney(
			[...jobs, ...trips].map((j) => j.paid),
			places
		),
		kept: sumMoney(
			[...jobs, ...trips].map((j) => j.kept),
			places
		),
		due_as: [...dueAs]
			.sort(([a], [b]) => orderOf(a) - orderOf(b))
			.map(([paid_as, v]) => ({ paid_as, amount: v.toFixed(places) })),
		rates: await anHourNow()
	};
}

/** Where what it pays is listed: pay by role, then what is paid back, then the unsaid. */
const orderOf = (as: PaidAs | null) =>
	as === null ? PAID_AS_ORDER.length : PAID_AS_ORDER.indexOf(as);

/**
 * The month's trips, each with what its legs billed and what they paid the
 * vehicle's owner (0024): nothing for the business's own, and not known for a
 * trip that does not say what it was driven in.
 */
async function tripsPaid(
	p: Period,
	places: number,
	first: ReadonlyMap<string, string>
): Promise<PayTrip[]> {
	const found = await db
		.selectFrom('trip')
		.leftJoin('vehicle', 'vehicle.id', 'trip.vehicle_id')
		.leftJoin('user as owner', 'owner.id', 'vehicle.owner_id')
		.select((eb) => [
			'trip.id',
			'trip.travelled_on',
			townsOf(eb.ref('trip.id')).as('towns'),
			'trip.vehicle_id',
			'vehicle.name as vehicle',
			'vehicle.owner_id',
			'owner.name as owner'
		])
		.where((eb) => eb.between('trip.travelled_on', p.start, p.end))
		.orderBy('trip.travelled_on')
		.orderBy('trip.id')
		.execute();
	if (!found.length) return [];
	const legs = await db
		.selectFrom('trip_leg')
		.select([
			'id',
			'trip_id as tripId',
			'service_id as serviceId',
			'entity_id as entityId',
			'miles'
		])
		.where('trip_id', '=', (eb) => eb.fn.any(eb.val(found.map((f) => f.id))))
		.execute();
	const worth = await valueLegs(
		db,
		legs.map((l) => {
			const f = found.find((x) => x.id === l.tripId)!;
			return {
				...l,
				travelledOn: f.travelled_on,
				vehicleId: f.vehicle_id,
				vehicleOwnerId: f.owner_id
			};
		})
	);
	const recorded = await recordedFor(
		[],
		found.map((f) => f.id)
	);
	return found.map((f) => {
		const mine = legs.filter((l) => l.tripId === f.id);
		const earned = sumKnown(mine.map((l) => worth.get(l.id)?.billed ?? null));
		const pays = mine.map((l) => worth.get(l.id)?.paid ?? null);
		// As a payment recorded it, or as it works out now.
		const kept = f.owner_id ? recorded.get(`${f.owner_id}:${f.id}`) : undefined;
		const paid = kept
			? kept.amount
			: pays.length && pays.every((x) => x !== null)
				? sum(pays)
				: null;
		return {
			trip_id: f.id,
			job: f.towns ?? 'No stops recorded',
			worked_on: f.travelled_on,
			vehicle: f.vehicle,
			owner: f.owner,
			miles: sum(mine.map((l) => l.miles)).toFixed(2),
			earned: earned?.toFixed(places) ?? null,
			paid: paid?.toFixed(places) ?? null,
			kept: earned && paid ? earned.sub(paid).toFixed(places) : null,
			recorded: kept ? kept.amount.toFixed(places) : null,
			paid_by: paidBy(kept ? [kept] : [], first)
		};
	});
}

/** "Sam paid Oct 8": each person a payment recorded for the work, at its latest. */
function paidBy(
	kept: readonly { userId: string; paidOn: string }[],
	first: ReadonlyMap<string, string>
): PaidBy[] {
	const latest = new Map<string, string>();
	for (const k of kept) if ((latest.get(k.userId) ?? '') < k.paidOn) latest.set(k.userId, k.paidOn);
	return [...latest].map(([id, paid_on]) => ({ who: first.get(id) ?? '', paid_on }));
}

/**
 * Everyone owed something, or paid before: what they are owed now, worked out
 * live -- for their work, and for their vehicle -- and their last payment. Most
 * owed first; the page groups them by what their role says their pay is.
 */
async function peopleOwed(places: number): Promise<PersonOwed[]> {
	const [owing, people, lastPaid] = await Promise.all([
		owed(),
		db
			.selectFrom('user')
			.leftJoin('role', 'role.id', 'user.role_id')
			.select(['user.id', 'user.name', 'role.name as role', 'role.pays_as'])
			.execute(),
		db
			.selectFrom('person_payment')
			.distinctOn('person_payment.user_id')
			.select((eb) => [
				'person_payment.user_id',
				'person_payment.paid_on',
				'person_payment.how',
				eb
					.selectFrom('person_payment_item as i')
					.select((eb) =>
						eb.cast<string>(eb.fn.coalesce(eb.fn.sum('i.amount'), eb.lit(0)), 'text').as('total')
					)
					// Named outright: unjoined, a bare id inside would be the item's.
					.whereRef('i.payment_id', '=', 'person_payment.id')
					.$asScalar()
					// An aggregate: always one row, so never null.
					.$notNull()
					.as('total')
			])
			.orderBy('person_payment.user_id')
			.orderBy('person_payment.paid_on', 'desc')
			.orderBy('person_payment.created_at', 'desc')
			.execute()
	]);
	return people
		.map((u) => {
			const items = owing.get(u.id) ?? [];
			const last = lastPaid.find((l) => l.user_id === u.id);
			return {
				id: u.id,
				name: u.name,
				role: u.role,
				pays_as: u.pays_as,
				owed: sum(items.map((i) => i.amount)).toFixed(places),
				owed_work: sum(
					items.filter((i) => i.paidAs !== 'reimbursement').map((i) => i.amount)
				).toFixed(places),
				owed_vehicle: sum(
					items.filter((i) => i.paidAs === 'reimbursement').map((i) => i.amount)
				).toFixed(places),
				unknown: items.filter((i) => i.amount === null).length,
				last: last
					? {
							paid_on: last.paid_on,
							how: last.how,
							total: Decimal.from(last.total).toFixed(places)
						}
					: null
			};
		})
		.filter((x) => x.last || Number(x.owed) !== 0 || x.unknown)
		.sort((a, b) => Number(b.owed) - Number(a.owed) || a.name.localeCompare(b.name));
}

export type HourNow = {
	service_id: string;
	service: string;
	crew: 'one' | 'team';
	who: string;
	billed: string;
	paid: string | null;
	kept: string;
	unpaid: boolean;
	since: string | null;
};

/**
 * What an hour of each hourly service is worth now, at the every-client price,
 * and what it leaves the business once its rules have paid.
 *
 * One person first, grouped by what they are paid: everybody paid alike is
 * one row, and a person whose own rule sets them apart gets their own. A
 * person no rule reaches is marked unpaid rather than shown as keeping it all,
 * which is what an unpaid person looks like from the business's side.
 *
 * Then the team, where there is one and the service has a team to price: an
 * additional-person rate of its own, or team entries already worked. Crossing
 * every hourly service with a team invents rows nobody works -- a team rate
 * for work no team ever does.
 *
 * Every figure comes from the valuation's billedAmount and timePay, the same
 * functions an entry is worked out by, so this cannot tell a different story
 * from the entries.
 */
export async function anHourNow(): Promise<HourNow[]> {
	const day = businessToday();
	const [catalogue, places] = await Promise.all([loadCatalogue(db), moneyPlaces()]);
	const names_ = new Map(
		(await db.selectFrom('user').select(['id', 'name']).execute()).map((u) => [u.id, u.name])
	);
	const people = team(catalogue.people);
	const services = await db
		.selectFrom('service')
		.select(['id', 'name'])
		.where('active', '=', true)
		.where('unit', '=', 'hour')
		.execute();
	const teamWorked = new Set(
		(
			await db
				.selectFrom('time_entry')
				.select('service_id')
				.distinct()
				.where('crew', '=', 'team')
				.execute()
		).map((r) => r.service_id)
	);

	const hour = Ratio.of(1);
	const later = (a: string | null, b: string | null) =>
		a === null ? b : b === null ? a : a > b ? a : b;
	const out: HourNow[] = [];
	for (const s of services) {
		const price = priceOn(catalogue.prices, s.id, null, day);
		const terms = catalogue.services.get(s.id);
		if (!price || !terms) continue;

		const billed = billedAmount(terms, jobRate(price, 1), hour, places)!;
		const alike = new Map<string, { who: string[]; paid: Decimal | null; since: string | null }>();
		for (const person of people) {
			const rule = ruleOn(catalogue.rules, s.id, person, null, 'time', day);
			const paid = timePay(rule, 3600, billed, places);
			const key = paid?.toString() ?? 'unpaid';
			const row = alike.get(key) ?? { who: [], paid, since: null };
			row.who.push(names_.get(person.id) ?? '');
			row.since = later(row.since, later(price.effectiveFrom, rule?.effectiveFrom ?? null));
			alike.set(key, row);
		}
		for (const row of alike.values())
			out.push({
				service_id: s.id,
				service: s.name,
				crew: 'one',
				who: names(row.who.sort()),
				billed: billed.toString(),
				paid: row.paid?.toString() ?? null,
				kept: billed.sub(row.paid ?? Decimal.ZERO).toFixed(places),
				unpaid: row.paid === null,
				since: row.since
			});

		if (people.length > 1 && (Decimal.from(price.additionalRate).gt(0) || teamWorked.has(s.id))) {
			const teamBilled = billedAmount(terms, jobRate(price, people.length), hour, places)!;
			const each = people.map((person) => {
				const rule = ruleOn(catalogue.rules, s.id, person, null, 'time', day);
				return {
					paid: timePay(rule, 3600, teamBilled, places),
					since: rule?.effectiveFrom ?? null
				};
			});
			const paid = sumKnown(each.map((x) => x.paid));
			const since = each.reduce<string | null>((a, x) => later(a, x.since), null);
			out.push({
				service_id: s.id,
				service: s.name,
				crew: 'team',
				// An hour with everybody holding a role on it.
				who: names(people.map((p) => names_.get(p.id) ?? '').sort()),
				billed: teamBilled.toString(),
				paid: paid?.toFixed(places) ?? null,
				kept: teamBilled.sub(paid ?? Decimal.ZERO).toFixed(places),
				unpaid: each.some((x) => x.paid === null),
				since: later(price.effectiveFrom, since)
			});
		}
	}
	return out.sort(
		(a, b) =>
			a.service.localeCompare(b.service) ||
			a.crew.localeCompare(b.crew) ||
			a.who.localeCompare(b.who)
	);
}

export type MeteredService = {
	service: string;
	allotment: string;
	cap_hours: string | null;
	hours_used: string;
	hours_left: string | null;
};

export type Responder = {
	person: string;
	hours: string;
	share: string;
	paid: string | null;
};

export type MeterRow = {
	agreement_id: string;
	client: string;
	// The one site the agreement is for, or null for the client as a whole.
	site: string | null;
	services: MeteredService[];
	responders: Responder[];
	// The retainer's own charge for the month: made, given, or not made yet.
	retainer: {
		state: 'charged' | 'given' | 'uncharged';
		amount: string;
		// What it charges at its price -- what a given month was worth.
		charge: string;
	};
	charged: string;
	paid: string | null;
};

export type RetainerMeter = {
	rows: MeterRow[];
	charged: string;
	paid: string | null;
	kept: string | null;
};

/**
 * What each agreement covered in a month, and what it earned -- one row an
 * agreement, so a practice's own pool and one office's agreement are metered
 * apart, as they are agreed apart.
 *
 * A retainer meters even when it is unlimited. That is the whole point of the
 * screen: at a flat price, hours used is the only way to tell whether the
 * retainer is priced anywhere near the work, and an unlimited allotment is
 * exactly the case where nobody is counting.
 *
 * An hour counts against the agreement it falls under: its site's, if its site
 * has one naming the service, and otherwise the client's. Every hour counts,
 * billable or not: an hour given away is still an hour the price has to carry.
 * A client without an agreement has no row here: nothing of theirs is covered.
 *
 * WHO ANSWERED, AND WHAT SHARE. Covered time pays a percentage of the retainer,
 * split by each person's share of the covered hours -- so the share is shown,
 * because it is what their pay was worked out from. Pay that depends on a
 * period not yet charged is not known, and says so rather than reading $0.
 */
export async function retainerMeter(p: Period): Promise<RetainerMeter> {
	const running = await db
		.selectFrom('agreement')
		.innerJoin('entity', 'entity.id', 'agreement.entity_id')
		.leftJoin('site', 'site.id', 'agreement.site_id')
		.select([
			'agreement.id',
			'agreement.entity_id',
			'agreement.price',
			'entity.name as client',
			'site.display as site'
		])
		.where('agreement.starts_on', '<=', p.end)
		.where((eb) =>
			eb.or([eb('agreement.ends_on', 'is', null), eb('agreement.ends_on', '>=', p.start)])
		)
		// A client's renewals at one place, newest first, as the rows keep them.
		.orderBy('agreement.starts_on', 'desc')
		.orderBy('agreement.id')
		.execute();
	if (!running.length) return { rows: [], charged: '0.00', paid: '0.00', kept: '0.00' };

	const entityIds = [...new Set(running.map((r) => r.entity_id))];
	const [agreements, entries, serviceNames, names, places] = await Promise.all([
		loadAgreements(db, entityIds),
		db
			.selectFrom('time_entry')
			.select(entryColumns)
			.where('time_entry.entity_id', '=', (eb) => eb.fn.any(eb.val(entityIds)))
			.where((eb) => eb.between('time_entry.worked_on', p.start, p.end))
			.execute(),
		db.selectFrom('service').select(['id', 'name']).execute(),
		db.selectFrom('user').select(['id', 'name']).execute(),
		moneyPlaces()
	]);
	const serviceName = new Map(serviceNames.map((s) => [s.id, s.name]));
	const personName = new Map(names.map((u) => [u.id, u.name]));
	const worth = await valueEntries(db, entries);

	// The agreement each of the month's hours falls under, by the same rule the
	// valuation covers it by: its site's first, then the client's.
	const fell = new Map<string, typeof entries>();
	for (const e of entries) {
		const hit = agreementFor(e, agreements);
		if (hit) fell.set(hit.a.id, [...(fell.get(hit.a.id) ?? []), e]);
	}

	const rows: MeterRow[] = [];
	for (const r of running) {
		const a = agreements.find((x) => x.id === r.id)!;
		const mine = fell.get(r.id) ?? [];

		const lines = a.services.map((s) => {
			const es = mine.filter((e) => e.serviceId === s.serviceId);
			const ws = es.map((e) => worth.get(e.id)!);
			const hours = Ratio.of(es.reduce((n, e) => n + e.seconds, 0))
				.div(3600)
				.round(2);
			const cap = s.allotment === 'capped' ? Decimal.from(s.includedHours ?? '0') : null;
			return {
				metered: {
					service: serviceName.get(s.serviceId) ?? '',
					allotment: s.allotment,
					cap_hours: cap?.toFixed(2) ?? null,
					hours_used: hours.toFixed(2),
					hours_left: cap ? Decimal.max(cap.sub(hours), Decimal.ZERO).toFixed(2) : null
				},
				billed: sum(es.filter((e) => e.billable).map((e) => worth.get(e.id)!.billed)),
				paid: sum(ws.map((w) => w.paid)),
				payUnknown: ws.some((w) => w.paid === null && (w.coveredSeconds ?? 0) > 0)
			};
		});

		// The agreement's own charge for the period, which is what the client
		// pays whether they call or not. It is charged in advance, so a month
		// under way already has one -- unless it was given, or nobody has charged
		// it yet.
		const periods = a.periods.filter((x) => x.periodStart <= p.end && x.periodEnd >= p.start);
		const amount = sum(periods.map((x) => x.amount));
		const given = periods.length > 0 && periods.every((x) => x.given);

		// Everyone who worked covered time under it, and their share of it in
		// person-hours: a team hour is one each.
		const byPerson = new Map<string, { seconds: number; paid: Decimal[]; unknown: boolean }>();
		for (const e of mine)
			for (const pp of worth.get(e.id)!.people) {
				if (!pp.coveredSeconds || pp.coveredSeconds <= 0) continue;
				const name = personName.get(pp.userId) ?? '';
				const g = byPerson.get(name) ?? { seconds: 0, paid: [], unknown: false };
				g.seconds += pp.coveredSeconds;
				if (pp.coveredPaid === null) g.unknown = true;
				else g.paid.push(pp.coveredPaid);
				byPerson.set(name, g);
			}
		const total = [...byPerson.values()].reduce((n, g) => n + g.seconds, 0);
		const responders: Responder[] = [...byPerson.entries()]
			.sort(([an, a1], [bn, b1]) => b1.seconds - a1.seconds || an.localeCompare(bn))
			.map(([person, g]) => ({
				person,
				hours: Ratio.of(g.seconds).div(3600).round(2).toString(),
				share: Ratio.of(g.seconds * 100)
					.div(total)
					.round(1)
					.toString(),
				paid: g.unknown ? null : sum(g.paid).toString()
			}));

		rows.push({
			agreement_id: r.id,
			client: r.client,
			site: r.site,
			services: lines.map((l) => l.metered).sort((x, y) => x.service.localeCompare(y.service)),
			responders,
			retainer: {
				state: periods.length === 0 ? 'uncharged' : given ? 'given' : 'charged',
				amount: amount.toFixed(places),
				charge: Decimal.from(r.price).toFixed(places)
			},
			charged: amount.add(sum(lines.map((l) => l.billed))).toFixed(places),
			paid: lines.some((l) => l.payUnknown) ? null : sum(lines.map((l) => l.paid)).toFixed(places)
		});
	}
	rows.sort(
		(x, y) =>
			x.client.localeCompare(y.client) ||
			(x.site === null ? -1 : y.site === null ? 1 : x.site.localeCompare(y.site))
	);

	const charged = sum(rows.map((r) => r.charged));
	// One agreement's pay not known yet is the total's not known yet: a sum that
	// quietly counts it as nothing overstates what was kept.
	const known = rows.every((r) => r.paid !== null);
	const paid = sum(rows.map((r) => r.paid));
	return {
		rows,
		charged: charged.toFixed(places),
		paid: known ? paid.toFixed(places) : null,
		kept: known ? charged.sub(paid).toFixed(places) : null
	};
}

export type GivenRow = { service: string; hours: string; worth: string | null };

/**
 * What the business costs itself: hours worked and not charged for, priced at
 * what they would have billed -- the client's own price where it has one. Time
 * given deliberately is still a cost, and it is shown so that giving it stays a
 * choice somebody can see.
 */
export async function nonBillable(p: Period) {
	const places = await moneyPlaces();
	const entries = await db
		.selectFrom('time_entry')
		.innerJoin('service', 'service.id', 'time_entry.service_id')
		.select([...entryColumns, 'service.name as service'])
		.where('time_entry.billable', '=', false)
		.where((eb) => eb.between('time_entry.worked_on', p.start, p.end))
		.execute();
	const worth = await valueEntries(db, entries);

	const groups = new Map<string, { seconds: number; billed: (Decimal | null)[] }>();
	for (const e of entries) {
		const g = groups.get(e.service) ?? { seconds: 0, billed: [] };
		g.seconds += e.seconds;
		g.billed.push(worth.get(e.id)!.billed);
		groups.set(e.service, g);
	}
	const rows: GivenRow[] = [...groups.entries()]
		.sort(([sa, a], [sb, b]) => b.seconds - a.seconds || sa.localeCompare(sb))
		.map(([service, g]) => ({
			service,
			hours: Ratio.of(g.seconds).div(3600).round(4).toString(),
			worth: sumKnown(g.billed)?.toFixed(places) ?? null
		}));
	const seconds = [...groups.values()].reduce((n, g) => n + g.seconds, 0);
	return {
		rows,
		hours: Ratio.of(seconds).div(3600).round(4).toString(),
		worth: sumMoney(
			rows.map((r) => r.worth),
			places
		)
	};
}
