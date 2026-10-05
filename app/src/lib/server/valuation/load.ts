/**
 * Loading what the valuation needs, so a page asks for entries and gets them
 * valued without knowing what that took.
 */
import { and, between, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { type Reader } from '../db/index.ts';
import { businessToday, businessDay } from '../calendar.ts';
import * as t from '../db/schema/index.ts';
import {
	agreementFor,
	worth,
	type Agreement,
	type Context,
	type Entry,
	type Worth
} from './entries.ts';
import type { ServiceTerms } from './pricing.ts';
import { legWorth } from './misc.ts';
import { moneyPlaces, taxRounding } from '../business.ts';
import { invoiceTax, type InvoiceTax } from './tax.ts';

/** The columns of a time entry the valuation reads. */
export const entryColumns = {
	id: t.timeEntry.id,
	entityId: t.timeEntry.entityId,
	siteId: t.timeEntry.siteId,
	serviceId: t.timeEntry.serviceId,
	workedOn: t.timeEntry.workedOn,
	seconds: t.timeEntry.seconds,
	billable: t.timeEntry.billable,
	crew: t.timeEntry.crew,
	workedBy: t.timeEntry.workedBy,
	createdAt: t.timeEntry.createdAt
};

/** Services, prices, pay rules and people: small tables, read whole. */
export async function loadCatalogue(r: Reader): Promise<Omit<Context, 'agreements' | 'places'>> {
	const [services, prices, rules, people] = await Promise.all([
		r
			.select({
				id: t.service.id,
				unit: t.service.unit,
				billToNearestSeconds: t.service.billToNearestSeconds,
				minimumCharge: t.service.minimumCharge
			})
			.from(t.service),
		r
			.select({
				serviceId: t.servicePrice.serviceId,
				entityId: t.servicePrice.entityId,
				rate: t.servicePrice.rate,
				additionalRate: t.servicePrice.additionalRate,
				effectiveFrom: t.servicePrice.effectiveFrom
			})
			.from(t.servicePrice),
		r
			.select({
				serviceId: t.payRule.serviceId,
				roleId: t.payRule.roleId,
				userId: t.payRule.userId,
				entityId: t.payRule.entityId,
				paysFor: t.payRule.paysFor,
				method: t.payRule.method,
				amount: t.payRule.amount,
				effectiveFrom: t.payRule.effectiveFrom
			})
			.from(t.payRule),
		r.select({ id: t.user.id, roleId: t.user.roleId, active: t.user.active }).from(t.user)
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
	const rows = await r.query.agreement.findMany({
		where: inArray(t.agreement.entityId, [...entityIds]),
		columns: { id: true, entityId: true, siteId: true, startsOn: true, endsOn: true },
		with: {
			services: {
				columns: { serviceId: true, allotment: true, includedHours: true, overage: true }
			},
			periods: {
				columns: { id: true, periodStart: true, periodEnd: true, amount: true, given: true }
			}
		}
	});
	return rows;
}

/**
 * Seconds worked this month under each of these agreements, service by
 * service, keyed `agreementId:serviceId`. Every hour counts against the
 * agreement it falls under -- its site's, or its client's where the site has
 * none of its own -- billable or not: the meter shows use, not charge.
 * `agreements` must hold all of their clients' agreements, so the site's can
 * win over the client's.
 */
export async function usedThisMonth(
	r: Reader,
	agreements: readonly Agreement[],
	today: string
): Promise<Map<string, number>> {
	const used = new Map<string, number>();
	const entityIds = [...new Set(agreements.map((a) => a.entityId))];
	if (!entityIds.length) return used;
	const entries = await r
		.select(entryColumns)
		.from(t.timeEntry)
		.where(
			and(
				inArray(t.timeEntry.entityId, entityIds),
				gte(t.timeEntry.workedOn, `${today.slice(0, 8)}01`)
			)
		);
	for (const e of entries) {
		const hit = agreementFor(e, agreements);
		if (!hit) continue;
		const key = `${hit.a.id}:${e.serviceId}`;
		used.set(key, (used.get(key) ?? 0) + e.seconds);
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
		.select(entryColumns)
		.from(t.timeEntry)
		.where(
			and(
				eq(t.timeEntry.billable, true),
				or(
					...ranges.map((x) =>
						and(eq(t.timeEntry.entityId, x.entityId), between(t.timeEntry.workedOn, x.from, x.to))
					)
				)
			)
		);
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

/** What each of these trip legs bills, at its service's price on the day it was driven. */
export async function valueLegs(
	r: Reader,
	legs: readonly {
		id: string;
		serviceId: string | null;
		entityId: string | null;
		miles: string;
		travelledOn: string;
	}[]
): Promise<Map<string, ReturnType<typeof legWorth>>> {
	if (!legs.length) return new Map();
	const [{ services, prices }, places] = await Promise.all([loadCatalogue(r), moneyPlaces()]);
	return new Map(legs.map((l) => [l.id, legWorth(l, l.travelledOn, services, prices, places)]));
}

/** The tax on each of these invoices, split by what CDTFA said about each line's site. */
export async function taxOfInvoices(
	r: Reader,
	invoiceIds: readonly string[]
): Promise<Map<string, InvoiceTax>> {
	if (!invoiceIds.length) return new Map();
	const ids = [...invoiceIds];
	const day = businessToday();
	const [lines, issued] = await Promise.all([
		r
			.select({
				invoiceId: t.invoiceLine.invoiceId,
				amount: t.invoiceLine.amount,
				taxable: t.invoiceLine.taxable,
				taxRatePct: t.invoiceLine.taxRatePct,
				siteId: t.invoiceLine.siteId
			})
			.from(t.invoiceLine)
			.where(inArray(t.invoiceLine.invoiceId, ids)),
		r
			.select({ id: t.invoice.id, issuedOn: t.invoice.issuedOn })
			.from(t.invoice)
			.where(inArray(t.invoice.id, ids))
	]);
	const sites = [...new Set(lines.map((l) => l.siteId).filter((x): x is string => x !== null))];
	const checks = sites.length
		? await r
				.select({
					siteId: t.siteTaxCheck.siteId,
					// The day it was asked, by the database's calendar.
					checkedOn: sql<string>`${businessDay(t.siteTaxCheck.checkedAt)}::text`,
					checkedAt: t.siteTaxCheck.checkedAt,
					ratePct: t.siteTaxCheck.ratePct,
					statePct: t.siteTaxCheck.stateRatePct,
					districtPct: t.siteTaxCheck.districtRatePct,
					jurisdiction: t.siteTaxCheck.taxJurisdiction
				})
				.from(t.siteTaxCheck)
				.where(inArray(t.siteTaxCheck.siteId, sites))
		: [];
	return invoiceTax(
		lines,
		checks,
		new Map(issued.map((i) => [i.id, i.issuedOn])),
		day,
		await taxRounding(),
		await moneyPlaces()
	);
}
