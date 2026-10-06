/**
 * What a time entry is worth: which retainer covers it and how much, what it
 * bills, what each person on it is paid, and what it earned.
 *
 * Pure functions over rows already loaded -- load.ts does the loading. Every
 * figure is rounded to its currency's places (#lib/currency) once, where it is
 * a figure, and not on the way.
 */
import { Decimal, Ratio } from '#lib/decimal.ts';
import { billedAmount, jobRate, priceOn, type Price, type ServiceTerms } from './pricing.ts';
import { coveredPay, ruleOn, timePay, type Payee, type PayRule } from './pay.ts';

export type Entry = {
	id: string;
	entityId: string | null;
	siteId: string | null;
	serviceId: string;
	workedOn: string;
	/** How long it took, in seconds. */
	seconds: number;
	billable: boolean;
	crew: 'one' | 'team';
	workedBy: string | null;
	/** Who a team entry names as its crew (0023); empty on one person's. */
	crewIds: readonly string[];
	createdAt: Date;
};

export type Agreement = {
	id: string;
	entityId: string;
	siteId: string | null;
	startsOn: string;
	endsOn: string | null;
	services: {
		serviceId: string;
		allotment: 'capped' | 'unlimited';
		includedHours: string | null;
		overage: 'bill' | 'no_charge' | 'deny' | null;
	}[];
	periods: { id: string; periodStart: string; periodEnd: string; amount: string; given: boolean }[];
};

export type Person = Payee & { active: boolean };

export type Coverage = {
	agreementId: string | null;
	periodId: string | null;
	periodCharge: Decimal | null;
	overage: Agreement['services'][number]['overage'];
	/** Seconds a retainer covered. Null when the pool cannot be drawn yet: capped, and its period not charged. */
	coveredSeconds: number | null;
};

const NONE: Coverage = {
	agreementId: null,
	periodId: null,
	periodCharge: null,
	overage: null,
	coveredSeconds: 0
};

/**
 * The agreement an entry falls under, if any: one of its client's that names
 * its service and is running on the day -- a site's own before the client's,
 * then the latest to start. Billable or not: the retainer meter counts every
 * hour against its agreement, though only billable work is covered.
 */
export function agreementFor(
	e: Pick<Entry, 'entityId' | 'siteId' | 'serviceId' | 'workedOn'>,
	agreements: readonly Agreement[]
) {
	if (e.entityId === null) return null;
	let best: { a: Agreement; s: Agreement['services'][number] } | null = null;
	for (const a of agreements) {
		if (a.entityId !== e.entityId) continue;
		if (a.siteId !== null && a.siteId !== e.siteId) continue;
		if (a.startsOn > e.workedOn || (a.endsOn !== null && a.endsOn < e.workedOn)) continue;
		const s = a.services.find((x) => x.serviceId === e.serviceId);
		if (!s) continue;
		if (
			!best ||
			(a.siteId !== null && best.a.siteId === null) ||
			((a.siteId !== null) === (best.a.siteId !== null) && a.startsOn > best.a.startsOn)
		)
			best = { a, s };
	}
	return best;
}

/**
 * How much of each entry a retainer covers. A capped pool is drawn in the order
 * the work was done, within the charged period, so `entries` must hold every
 * entry of every period any of them falls in -- load.ts makes sure of it.
 */
export function coverage(
	entries: readonly Entry[],
	agreements: readonly Agreement[]
): Map<string, Coverage> {
	const found = new Map<string, Coverage>();
	type Drawn = { e: Entry; s: Agreement['services'][number]; c: Coverage };
	const byPool = new Map<string, Drawn[]>();

	for (const e of entries) {
		const hit = e.billable ? agreementFor(e, agreements) : null;
		if (!hit) {
			found.set(e.id, NONE);
			continue;
		}
		const period = hit.a.periods.find(
			(p) => p.periodStart <= e.workedOn && e.workedOn <= p.periodEnd
		);
		const c: Coverage = {
			agreementId: hit.a.id,
			periodId: period?.id ?? null,
			periodCharge: period ? Decimal.from(period.amount) : null,
			overage: hit.s.overage,
			coveredSeconds: null
		};
		found.set(e.id, c);
		if (hit.s.allotment === 'unlimited') c.coveredSeconds = e.seconds;
		else if (period) {
			const key = `${period.id}:${e.serviceId}`;
			byPool.set(key, [...(byPool.get(key) ?? []), { e, s: hit.s, c }]);
		}
	}

	for (const drawn of byPool.values()) {
		drawn.sort(
			(x, y) =>
				x.e.workedOn.localeCompare(y.e.workedOn) ||
				x.e.createdAt.getTime() - y.e.createdAt.getTime() ||
				(x.e.id < y.e.id ? -1 : x.e.id > y.e.id ? 1 : 0)
		);
		let before = 0;
		for (const { e, s, c } of drawn) {
			const pool = Number(
				Decimal.from(s.includedHours ?? '0')
					.mul(3600)
					.toBigInt()
			);
			c.coveredSeconds = Math.max(Math.min(e.seconds, pool - before), 0);
			before += e.seconds;
		}
	}
	return found;
}

export type Context = {
	services: ReadonlyMap<string, ServiceTerms>;
	prices: readonly Price[];
	rules: readonly PayRule[];
	people: readonly Person[];
	agreements: readonly Agreement[];
	/** How many places the business's currency has: 2 for dollars, 0 for yen. */
	places: number;
};

export type PersonPay = {
	userId: string;
	coveredSeconds: number | null;
	timePaid: Decimal | null;
	coveredPaid: Decimal | null;
	paid: Decimal | null;
};

export type Worth = {
	entryId: string;
	heads: number;
	/** The job's rate with this many people on it. */
	rate: Decimal | null;
	coveredSeconds: number | null;
	billedSeconds: number | null;
	/** What the uncovered seconds bill. Null when unknown: no price, or a pool not yet drawable. */
	billed: Decimal | null;
	/** The covered seconds' part of the retainer's charge, for everyone on the entry. */
	coveredShare: Decimal | null;
	/** Billed plus the covered share: what the work brought in. */
	earned: Decimal | null;
	/** Everyone's pay added up, leaving out anyone whose pay is not known. Null when nobody's is. */
	paid: Decimal | null;
	people: PersonPay[];
	coverage: Coverage;
};

/**
 * The team: everyone active who holds a role. What a team timer ticks unless it
 * is changed, and what a team entry is taken as where it names nobody -- one
 * a phone queued before entries named their crew.
 */
export const team = (people: readonly Person[]) =>
	people.filter((p) => p.active && p.roleId !== null);

/** What each entry is worth. `entries` must include every entry the coverage depends on. */
export function worth(entries: readonly Entry[], ctx: Context): Map<string, Worth> {
	const covered = coverage(entries, ctx.agreements);
	const everyone = team(ctx.people);
	// A team entry is priced at the crew it names and pays each of them.
	const crewOf = (e: Entry) =>
		e.crewIds.length ? ctx.people.filter((p) => e.crewIds.includes(p.id)) : everyone;
	const headsOf = (e: Entry) => (e.crew === 'team' ? crewOf(e).length : 1);

	// Each period's covered person-seconds, which its charge is divided by.
	const personSeconds = new Map<string, bigint>();
	for (const e of entries) {
		const c = covered.get(e.id)!;
		if (c.periodId === null || !c.coveredSeconds) continue;
		personSeconds.set(
			c.periodId,
			(personSeconds.get(c.periodId) ?? 0n) + BigInt(c.coveredSeconds * headsOf(e))
		);
	}

	const { places } = ctx;
	const zero = Decimal.ZERO.round(places);
	const out = new Map<string, Worth>();
	for (const e of entries) {
		const c = covered.get(e.id)!;
		const heads = headsOf(e);
		const service = ctx.services.get(e.serviceId);
		const rate = jobRate(priceOn(ctx.prices, e.serviceId, e.entityId, e.workedOn), heads);
		const billedSeconds = c.coveredSeconds === null ? null : e.seconds - c.coveredSeconds;

		let billed: Decimal | null;
		if (billedSeconds === null || !service) billed = null;
		else if (billedSeconds === 0) billed = zero;
		else if (c.agreementId !== null && c.overage === 'no_charge') billed = zero;
		else
			billed = billedAmount(
				service,
				rate,
				service.unit === 'each' ? Ratio.of(1) : Ratio.of(billedSeconds).div(3600),
				places
			);

		const pm = c.periodId !== null ? personSeconds.get(c.periodId) : undefined;
		const shareEach: Ratio | null =
			c.coveredSeconds && c.coveredSeconds > 0 && c.periodCharge && pm
				? Ratio.of(c.periodCharge).mul(c.coveredSeconds).div(pm)
				: null;

		const payees = e.crew === 'team' ? crewOf(e) : ctx.people.filter((p) => p.id === e.workedBy);
		const people: PersonPay[] = payees.map((p) => {
			const timePaid =
				billedSeconds !== null && billedSeconds > 0
					? timePay(
							ruleOn(ctx.rules, e.serviceId, p, e.entityId, 'time', e.workedOn),
							billedSeconds,
							billed,
							places
						)
					: zero;
			const coveredPaid =
				c.coveredSeconds && c.coveredSeconds > 0
					? coveredPay(
							ruleOn(ctx.rules, e.serviceId, p, e.entityId, 'covered_time', e.workedOn),
							shareEach,
							places
						)
					: zero;
			return {
				userId: p.id,
				coveredSeconds: c.coveredSeconds,
				timePaid,
				coveredPaid,
				paid: timePaid && coveredPaid ? timePaid.add(coveredPaid) : null
			};
		});
		const known = people.filter((p) => p.paid !== null);
		const paid = known.length ? known.reduce((n, p) => n.add(p.paid!), zero) : null;

		const coveredShare = shareEach ? shareEach.mul(heads).round(places) : null;
		let earned: Decimal | null = null;
		if (billed !== null) {
			if (!c.coveredSeconds || c.coveredSeconds <= 0) earned = billed;
			else if (shareEach) earned = shareEach.mul(heads).add(billed).round(places);
		}

		out.set(e.id, {
			entryId: e.id,
			heads,
			rate,
			coveredSeconds: c.coveredSeconds,
			billedSeconds,
			billed,
			coveredShare,
			earned,
			paid,
			people,
			coverage: c
		});
	}
	return out;
}
