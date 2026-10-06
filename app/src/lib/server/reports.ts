import { and, asc, between, eq, inArray, lte, gte, isNull, or, sql } from 'drizzle-orm';
import { Decimal, sum, sumMoney } from '#lib/decimal.ts';
import { db } from './db/index.ts';
import { businessToday } from './calendar.ts';
import { moneyPlaces } from './business.ts';
import * as t from './db/schema/index.ts';
import type { Period } from './periods.ts';
import { agreementFor, team } from './valuation/entries.ts';
import {
	entryColumns,
	loadAgreements,
	loadCatalogue,
	taxOfInvoices,
	valueEntries
} from './valuation/load.ts';
import { billedAmount, jobRate, priceOn } from './valuation/pricing.ts';
import { ruleOn, timePay } from './valuation/pay.ts';
import { rateIsStale } from './stale.ts';
import { dated, daysAgo, names } from '#lib/format.ts';
import { crewNames } from './choices.ts';
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
	state_rate_pct: string | null;
	district_rate_pct: string | null;
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
	unchecked: { site: string; client: string; why: string }[];
	overrides: { invoice: string; description: string; rate_pct: string; reason: string | null }[];
};

/**
 * Schedule A: the measure and the deduction, by the CDTFA area the work
 * happened in.
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
 * An address CDTFA has not been asked about lately is listed by name. The rate
 * on file is not wrong, but it is not known to be right either, and a district
 * added or ended in between would have been charged wrongly ever since.
 */
/**
 * Schedule A: the measure and the deduction, by the CDTFA area the work
 * happened in.
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
 * An address CDTFA has not been asked about lately is listed by name. The rate
 * on file is not wrong, but it is not known to be right either, and a district
 * added or ended in between would have been charged wrongly ever since.
 */
export async function scheduleA(p: Period): Promise<ScheduleA> {
	const [[{ claims }], places] = await Promise.all([
		db.select({ claims: t.operator.claimsTaxPaidPurchasesResold }).from(t.operator),
		moneyPlaces()
	]);
	const { site, invoice, invoiceLine, entity } = t;

	const { rows: districts } = await db.execute<DistrictRow>(sql`
		with billed as (
			select ${invoiceLine.siteId} as site_id, ${invoiceLine.amount} as amount,
			       ${invoiceLine.exTaxCost} as ex_tax_cost
			  from ${invoiceLine}
			  join ${invoice} on ${invoice.id} = ${invoiceLine.invoiceId}
			 where ${invoice.status} in ('sent', 'paid')
			   and ${invoice.issuedOn} between ${p.start} and ${p.end}
			   and ${invoiceLine.taxable}
		)
		select ${site.taxJurisdiction} as area,
		       max(${site.taxRatePct})::text as rate_pct,
		       max(${site.stateRatePct})::text as state_rate_pct,
		       max(${site.districtRatePct})::text as district_rate_pct,
		       round(coalesce(sum(b.amount), 0), ${places}::int)::text as measure,
		       -- Reg 1701: tax already paid on goods that were resold comes off
		       -- the measure, and only if the operator has made that election.
		       round(case when ${claims} then coalesce(sum(b.ex_tax_cost), 0)
		                  else 0 end, ${places}::int)::text as deduction,
		       round(coalesce(sum(b.amount), 0)
		             - case when ${claims} then coalesce(sum(b.ex_tax_cost), 0)
		                    else 0 end, ${places}::int)::text as net,
		       round((coalesce(sum(b.amount), 0)
		              - case when ${claims} then coalesce(sum(b.ex_tax_cost), 0)
		                     else 0 end)
		             * coalesce(max(${site.taxRatePct}), 0) / 100, ${places}::int)::text as tax,
		       count(b.*)::int as lines,
		       count(distinct ${site.id})::int as sites
		  from ${site}
		  left join billed b on b.site_id = ${site.id}
		 where ${site.active}
		 group by ${site.taxJurisdiction}
		 order by 1`);

	const { rows: stale } = await db.execute<{
		site: string;
		client: string;
		priced_on: string;
		days: number;
	}>(sql`
		select ${site.display} as site, ${entity.name} as client,
		       ${site.areaVerifiedOn}::text as priced_on,
		       ${businessToday()}::date - ${site.areaVerifiedOn} as days
		  from ${site}
		  join ${entity} on ${entity.id} = ${site.entityId}
		 where ${site.active} and ${rateIsStale(site.areaVerifiedOn, businessToday())}
		 order by ${site.areaVerifiedOn}, ${entity.name}, ${site.display}`);

	// A rate that did not come from the site is never folded into an area.
	// It is shown on its own, with the reason it was overridden.
	const overrides = await db
		.select({
			invoice: invoice.number,
			description: invoiceLine.description,
			rate_pct: invoiceLine.taxRatePct,
			reason: invoiceLine.taxOverrideReason
		})
		.from(invoiceLine)
		.innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
		.where(
			and(
				inArray(invoice.status, ['sent', 'paid']),
				between(invoice.issuedOn, p.start, p.end),
				eq(invoiceLine.taxSource, 'override')
			)
		)
		.orderBy(asc(invoice.number), asc(invoiceLine.seq));

	return {
		districts,
		due: sumMoney(
			districts.map((d) => d.tax),
			places
		),
		claimsResold: claims,
		unchecked: stale.map(({ site, client, priced_on, days }) => ({
			site,
			client,
			why: `Last priced ${dated(priced_on)}, ${daysAgo(days)}`
		})),
		overrides
	};
}

export type Obligation = {
	charged: string;
	state: string;
	district: string;
	remitted: string;
	outstanding: string;
	estimated_lines: number;
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
 * What was collected on somebody else's behalf, what has been handed over, and
 * the difference.
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
export async function taxObligation(p: Period): Promise<Obligation> {
	const { invoice, taxRemittance: tr } = t;
	const places = await moneyPlaces();
	const raised = await db
		.select({ id: invoice.id })
		.from(invoice)
		.where(
			and(inArray(invoice.status, ['sent', 'paid']), between(invoice.issuedOn, p.start, p.end))
		);
	const taxes = [
		...(
			await taxOfInvoices(
				db,
				raised.map((r) => r.id)
			)
		).values()
	];

	const filings = await db
		.select({
			id: tr.id,
			period_start: tr.periodStart,
			period_end: tr.periodEnd,
			filed_on: tr.filedOn,
			paid_on: tr.paidOn,
			amount: tr.amount,
			reference: tr.reference
		})
		.from(tr)
		.where(and(lte(tr.periodStart, p.end), gte(tr.periodEnd, p.start)))
		.orderBy(asc(tr.periodStart));

	const charged = sum(taxes.map((x) => x.tax));
	const remitted = sum(filings.map((f) => f.amount));
	return {
		charged: charged.toFixed(places),
		state: sumMoney(
			taxes.map((x) => x.stateTax),
			places
		),
		district: sumMoney(
			taxes.map((x) => x.districtTax),
			places
		),
		estimated_lines: taxes.reduce((n, x) => n + x.estimatedLines, 0),
		remitted: remitted.toFixed(places),
		outstanding: charged.sub(remitted).toFixed(places),
		filings
	};
}

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
};

export type PayOwed = {
	jobs: PayJob[];
	due: string;
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
		.select({
			...entryColumns,
			place: sql<string>`coalesce(${t.site.display}, ${t.entity.name})`,
			who: t.user.name,
			teamNames: crewNames(sql`${t.timeEntry.id}`)
		})
		.from(t.timeEntry)
		.innerJoin(t.entity, eq(t.entity.id, t.timeEntry.entityId))
		.leftJoin(t.site, eq(t.site.id, t.timeEntry.siteId))
		.leftJoin(t.user, eq(t.user.id, t.timeEntry.workedBy))
		.where(and(eq(t.timeEntry.billable, true), between(t.timeEntry.workedOn, p.start, p.end)));
	const worth = await valueEntries(db, entries);

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
		const paid = sumKnown(w.map((x) => x.paid));
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
			kept: earned && paid ? earned.sub(paid).toFixed(places) : null
		};
	});
	jobs.sort((a, b) => a.worked_on.localeCompare(b.worked_on) || a.job.localeCompare(b.job));

	return {
		jobs,
		due: sumMoney(
			jobs.map((j) => j.paid),
			places
		),
		kept: sumMoney(
			jobs.map((j) => j.kept),
			places
		),
		rates: await anHourNow()
	};
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
		(await db.select({ id: t.user.id, name: t.user.name }).from(t.user)).map((u) => [u.id, u.name])
	);
	const people = team(catalogue.people);
	const services = await db
		.select({ id: t.service.id, name: t.service.name })
		.from(t.service)
		.where(and(eq(t.service.active, true), eq(t.service.unit, 'hour')));
	const teamWorked = new Set(
		(
			await db
				.selectDistinct({ id: t.timeEntry.serviceId })
				.from(t.timeEntry)
				.where(eq(t.timeEntry.crew, 'team'))
		).map((r) => r.id)
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
		.select({
			id: t.agreement.id,
			entityId: t.agreement.entityId,
			price: t.agreement.price,
			client: t.entity.name,
			site: t.site.display
		})
		.from(t.agreement)
		.innerJoin(t.entity, eq(t.entity.id, t.agreement.entityId))
		.leftJoin(t.site, eq(t.site.id, t.agreement.siteId))
		.where(
			and(
				lte(t.agreement.startsOn, p.end),
				or(isNull(t.agreement.endsOn), gte(t.agreement.endsOn, p.start))
			)
		);
	if (!running.length) return { rows: [], charged: '0.00', paid: '0.00', kept: '0.00' };

	const entityIds = [...new Set(running.map((r) => r.entityId))];
	const [agreements, entries, serviceNames, names, places] = await Promise.all([
		loadAgreements(db, entityIds),
		db
			.select(entryColumns)
			.from(t.timeEntry)
			.where(
				and(inArray(t.timeEntry.entityId, entityIds), between(t.timeEntry.workedOn, p.start, p.end))
			),
		db.select({ id: t.service.id, name: t.service.name }).from(t.service),
		db.select({ id: t.user.id, name: t.user.name }).from(t.user),
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
		.select({ ...entryColumns, service: t.service.name })
		.from(t.timeEntry)
		.innerJoin(t.service, eq(t.service.id, t.timeEntry.serviceId))
		.where(and(eq(t.timeEntry.billable, false), between(t.timeEntry.workedOn, p.start, p.end)));
	const worth = await valueEntries(db, entries);

	const groups = new Map<string, { seconds: number; billed: (Decimal | null)[] }>();
	for (const e of entries) {
		const g = groups.get(e.service) ?? { seconds: 0, billed: [] };
		g.seconds += e.seconds;
		g.billed.push(worth.get(e.id)!.billed);
		groups.set(e.service, g);
	}
	const rows: GivenRow[] = [...groups.entries()]
		.sort(([, a], [, b]) => b.seconds - a.seconds)
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
