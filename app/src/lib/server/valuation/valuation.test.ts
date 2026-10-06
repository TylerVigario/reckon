/**
 * The arithmetic, proved. These are the cases the guard suite proved in SQL
 * before the calculations moved here, with the same figures, so the move
 * changed where they run and nothing about what they say.
 */
import { describe, expect, it } from 'vitest';
import { Decimal, Ratio } from '#lib/decimal.ts';
import { billedAmount, jobRate, priceOn, type Price, type ServiceTerms } from './pricing.ts';
import { coveredPay, ruleOn, timePay, type PayRule } from './pay.ts';
import {
	agreementFor,
	coverage,
	worth,
	type Agreement,
	type Context,
	type Entry,
	type Person
} from './entries.ts';
import { invoiceTax } from './tax.ts';
import { TAX_ROUNDING, type TaxRounding } from '../tax-rules.ts';
import { billingDate, hoursOf, legWorth, materialWorth } from './misc.ts';

const AVERY = { id: 'u-avery', roleId: 'r-partner', active: true };
const SAM = { id: 'u-sam', roleId: 'r-partner', active: true };
const VISITOR = { id: 'u-visitor', roleId: null, active: true };
const PEOPLE: Person[] = [AVERY, SAM, VISITOR];

const ALDER = 'e-alder';
const BLUEGILL = 'e-bluegill';

const hourly = (id: string, over: Partial<ServiceTerms> = {}): ServiceTerms => ({
	id,
	unit: 'hour',
	billToNearestSeconds: 60,
	minimumCharge: null,
	...over
});

const price = (
	serviceId: string,
	rate: string,
	additionalRate = '0',
	effectiveFrom = '2026-01-01',
	entityId: string | null = null
): Price => ({
	serviceId,
	entityId,
	rate,
	additionalRate,
	effectiveFrom
});

const rule = (over: Partial<PayRule> & Pick<PayRule, 'serviceId' | 'method'>): PayRule => ({
	roleId: null,
	userId: null,
	entityId: null,
	paysFor: 'time',
	amount: null,
	effectiveFrom: '2026-01-01',
	...over
});

/** A figure exactly as the valuation returns it: to the cent, written as it is held. */
const money = (d: Decimal | null) => (d === null ? null : d.toString());

/** Dollars. Yen and dinars have their own cases at the end. */
const CENTS = 2;

describe('a price counts heads', () => {
	const p = price('field', '95.00', '45.00', '2026-08-03');
	it('is the first person and each one after', () => {
		expect(money(jobRate(p, 1))).toBe('95.00');
		expect(money(jobRate(p, 2))).toBe('140.00');
		expect(money(jobRate(p, 3))).toBe('185.00');
	});

	it("takes the client's own price, then the newest that has started", () => {
		const prices = [
			price('field', '65.00', '0', '2024-01-01'),
			price('field', '95.00', '45.00', '2026-06-15'),
			price('field', '80.00', '0', '2026-01-01', ALDER)
		];
		expect(priceOn(prices, 'field', BLUEGILL, '2026-07-01')?.rate).toBe('95.00');
		expect(priceOn(prices, 'field', BLUEGILL, '2025-07-01')?.rate).toBe('65.00');
		expect(priceOn(prices, 'field', ALDER, '2026-07-01')?.rate).toBe('80.00');
		expect(priceOn(prices, 'field', BLUEGILL, '2023-01-01')).toBeNull();
	});
});

describe('an entry bills to the increment, and never below the minimum', () => {
	const rate = Decimal.from('95.00');
	it('rounds 22 min 40 s to the nearest minute: 23 min, $36.42', () => {
		expect(money(billedAmount(hourly('field'), rate, Ratio.of(1360).div(3600), CENTS))).toBe(
			'36.42'
		);
	});
	it('floors the same visit at a $50.00 minimum', () => {
		const s = hourly('field', { minimumCharge: '50.00' });
		expect(money(billedAmount(s, rate, Ratio.of(1360).div(3600), CENTS))).toBe('50.00');
	});
	it('bills exact time when there is no increment', () => {
		const s = hourly('field', { billToNearestSeconds: null });
		expect(money(billedAmount(s, rate, Ratio.of(1360).div(3600), CENTS))).toBe('35.89');
	});
	it('bills a service charged each one unit, however long the entry ran', () => {
		const survey: ServiceTerms = {
			id: 'survey',
			unit: 'each',
			billToNearestSeconds: null,
			minimumCharge: null
		};
		expect(money(billedAmount(survey, Decimal.from('180.00'), Ratio.of(1), CENTS))).toBe('180.00');
	});
	it('bills nothing without a price', () => {
		expect(billedAmount(hourly('field'), null, Ratio.of(1), CENTS)).toBeNull();
	});
});

describe("a pay rule: the client's, then the person's, then the role's, then the latest to start", () => {
	const rules: PayRule[] = [
		rule({
			serviceId: 'standby',
			roleId: 'r-partner',
			method: 'per_hour',
			amount: '28',
			effectiveFrom: '2026-09-01'
		}),
		rule({
			serviceId: 'standby',
			roleId: 'r-partner',
			method: 'per_hour',
			amount: '33',
			effectiveFrom: '2026-10-01'
		}),
		rule({
			serviceId: 'standby',
			roleId: 'r-partner',
			method: 'per_hour',
			amount: '99',
			effectiveFrom: '2027-01-01'
		}),
		rule({
			serviceId: 'standby',
			userId: SAM.id,
			method: 'per_hour',
			amount: '40',
			effectiveFrom: '2026-09-01'
		}),
		rule({
			serviceId: 'standby',
			roleId: 'r-partner',
			entityId: ALDER,
			method: 'per_hour',
			amount: '20',
			effectiveFrom: '2026-09-01'
		})
	];
	const amount = (who: typeof AVERY, entityId: string, day: string) =>
		ruleOn(rules, 'standby', who, entityId, 'time', day)?.amount;

	it("a client's own rule beats even a person's own", () => {
		expect(amount(SAM, ALDER, '2026-10-15')).toBe('20');
	});
	it("a person's own rule beats their role's newer one", () => {
		expect(amount(SAM, BLUEGILL, '2026-10-15')).toBe('40');
	});
	it('the newest that has started, and not one that has not', () => {
		expect(amount(AVERY, BLUEGILL, '2026-09-15')).toBe('28');
		expect(amount(AVERY, BLUEGILL, '2026-10-15')).toBe('33');
		expect(amount(AVERY, BLUEGILL, '2026-12-31')).toBe('33');
	});
	it('reaches nobody who holds no role and has no rule', () => {
		expect(ruleOn(rules, 'standby', VISITOR, BLUEGILL, 'time', '2026-10-15')).toBeNull();
	});
});

describe('time pays by the second, by the line, by the entry, or not', () => {
	const rules: PayRule[] = [
		rule({
			serviceId: 'callout',
			userId: AVERY.id,
			method: 'per_hour',
			amount: '45',
			effectiveFrom: '2026-10-01'
		}),
		rule({
			serviceId: 'callout',
			userId: SAM.id,
			method: 'percent',
			amount: '100',
			effectiveFrom: '2026-10-01'
		}),
		rule({
			serviceId: 'callout',
			roleId: 'r-partner',
			entityId: BLUEGILL,
			method: 'fixed',
			amount: '15',
			effectiveFrom: '2026-10-01'
		}),
		rule({
			serviceId: 'callout',
			userId: SAM.id,
			entityId: BLUEGILL,
			method: 'nothing',
			effectiveFrom: '2026-10-01'
		})
	];
	const pay = (who: typeof AVERY, entityId: string, line: string) =>
		money(
			timePay(
				ruleOn(rules, 'callout', who, entityId, 'time', '2026-10-15'),
				1360,
				Decimal.from(line),
				CENTS
			)
		);

	it('per hour: 1,360 s at $45.00 is $17.00, as worked', () =>
		expect(pay(AVERY, ALDER, '36.42')).toBe('17.00'));
	it('percent: 100% of a $28.80 line', () => expect(pay(SAM, ALDER, '28.80')).toBe('28.80'));
	it('fixed: $15.00 for the entry', () => expect(pay(AVERY, BLUEGILL, '36.42')).toBe('15.00'));
	it('nothing: $0.00, because a rule says so', () =>
		expect(pay(SAM, BLUEGILL, '36.42')).toBe('0.00'));
	it('no rule: null, not a zero', () => {
		expect(
			timePay(ruleOn(rules, 'callout', VISITOR, BLUEGILL, 'time', '2026-10-15'), 3600, null, CENTS)
		).toBeNull();
	});
});

describe('covered time pays a share of the retainer', () => {
	const pct = (amount: string) =>
		rule({ serviceId: 'helpdesk', paysFor: 'covered_time', method: 'percent', amount });
	it('15% of a $210 month is $31.50', () => {
		expect(money(coveredPay(pct('15'), Ratio.of('210.00'), CENTS))).toBe('31.50');
	});
	it('a share of a charge not yet made is unknown', () => {
		expect(coveredPay(pct('15'), null, CENTS)).toBeNull();
	});
	it('0%, or nothing, is known without a charge', () => {
		expect(money(coveredPay(pct('0'), null, CENTS))).toBe('0.00');
		expect(
			money(
				coveredPay(
					rule({ serviceId: 'helpdesk', paysFor: 'covered_time', method: 'nothing' }),
					null,
					CENTS
				)
			)
		).toBe('0.00');
	});
});

describe('the month-end rule does not drift', () => {
	it('the 31st bills the last day of a short month and comes back', () => {
		expect(billingDate('2026-01-01', 31)).toBe('2026-01-31');
		expect(billingDate('2026-02-01', 31)).toBe('2026-02-28');
		expect(billingDate('2026-03-01', 31)).toBe('2026-03-31');
		expect(billingDate('2026-04-01', 31)).toBe('2026-04-30');
		expect(billingDate('2028-02-01', 31)).toBe('2028-02-29');
	});
	it('a day every month has is never moved', () =>
		expect(billingDate('2026-02-01', 12)).toBe('2026-02-12'));
});

// ------------------------------------------------------------ retainers --

let n = 0;
const entry = (
	over: Partial<Entry> & Pick<Entry, 'entityId' | 'serviceId' | 'workedOn' | 'seconds'>
): Entry => ({
	id: `t-${String(++n).padStart(3, '0')}`,
	siteId: null,
	billable: true,
	crew: 'one',
	workedBy: AVERY.id,
	createdAt: new Date(`2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z`),
	...over
});

describe('a retainer pays a share of itself, split by the hours each spent', () => {
	const RETAINED = 'e-retained';
	const CAPPED = 'e-capped';
	const KINGFISHER = 'e-kingfisher';
	const agreements: Agreement[] = [
		{
			id: 'a-retained',
			entityId: RETAINED,
			siteId: null,
			startsOn: '2026-10-01',
			endsOn: null,
			services: [
				{ serviceId: 'retained', allotment: 'unlimited', includedHours: null, overage: null }
			],
			periods: [
				{
					id: 'p-retained-oct',
					periodStart: '2026-10-01',
					periodEnd: '2026-10-31',
					amount: '250.00',
					given: false
				}
			]
		},
		{
			id: 'a-capped',
			entityId: CAPPED,
			siteId: null,
			startsOn: '2026-10-01',
			endsOn: null,
			services: [
				{ serviceId: 'retained', allotment: 'capped', includedHours: '1.5', overage: 'bill' }
			],
			periods: [
				{
					id: 'p-capped-oct',
					periodStart: '2026-10-01',
					periodEnd: '2026-10-31',
					amount: '240.00',
					given: false
				}
			]
		},
		{
			id: 'a-kingfisher',
			entityId: KINGFISHER,
			siteId: null,
			startsOn: '2026-08-01',
			endsOn: null,
			services: [
				{ serviceId: 'helpdesk', allotment: 'unlimited', includedHours: null, overage: null }
			],
			periods: [
				{
					id: 'p-kf-sep',
					periodStart: '2026-09-01',
					periodEnd: '2026-09-30',
					amount: '210.00',
					given: false
				}
			]
		}
	];
	const rules = (kingfisher: PayRule['method'], kfAmount: string | null): PayRule[] => [
		rule({ serviceId: 'retained', roleId: 'r-partner', method: 'per_hour', amount: '26' }),
		rule({
			serviceId: 'retained',
			roleId: 'r-partner',
			paysFor: 'covered_time',
			method: 'percent',
			amount: '16'
		}),
		rule({
			serviceId: 'helpdesk',
			roleId: 'r-partner',
			entityId: KINGFISHER,
			paysFor: 'covered_time',
			method: kingfisher,
			amount: kfAmount
		})
	];
	const ctx = (over: Partial<Context> = {}): Context => ({
		services: new Map([
			['retained', hourly('retained')],
			['helpdesk', hourly('helpdesk')]
		]),
		prices: [price('retained', '60.00'), price('helpdesk', '60.00')],
		rules: rules('percent', '15'),
		people: PEOPLE,
		agreements,
		places: CENTS,
		...over
	});

	const r1 = entry({
		entityId: RETAINED,
		serviceId: 'retained',
		workedOn: '2026-10-05',
		seconds: 45 * 60
	});
	const r2 = entry({
		entityId: RETAINED,
		serviceId: 'retained',
		workedOn: '2026-10-06',
		seconds: 30 * 60,
		crew: 'team',
		workedBy: null
	});
	const c3 = entry({
		entityId: CAPPED,
		serviceId: 'retained',
		workedOn: '2026-10-02',
		seconds: 60 * 60
	});
	const c4 = entry({
		entityId: CAPPED,
		serviceId: 'retained',
		workedOn: '2026-10-03',
		seconds: 45 * 60,
		workedBy: SAM.id
	});
	const c5 = entry({
		entityId: CAPPED,
		serviceId: 'retained',
		workedOn: '2026-10-04',
		seconds: 30 * 60
	});
	const r6 = entry({
		entityId: RETAINED,
		serviceId: 'retained',
		workedOn: '2026-11-03',
		seconds: 45 * 60
	});
	const c7 = entry({
		entityId: CAPPED,
		serviceId: 'retained',
		workedOn: '2026-11-03',
		seconds: 45 * 60
	});
	const k8 = entry({
		entityId: KINGFISHER,
		serviceId: 'helpdesk',
		workedOn: '2026-10-10',
		seconds: 30 * 60
	});
	const all = [r1, r2, c3, c4, c5, r6, c7, k8];

	it('16% of a $250 retainer, split 75:30 by person-minutes', () => {
		const w = worth(all, ctx());
		const paidTo = (id: string) =>
			[r1, r2]
				.flatMap((e) => w.get(e.id)!.people)
				.filter((p) => p.userId === id)
				.reduce((s, p) => s.add(p.paid!), Decimal.ZERO)
				.toFixed(2);
		expect(w.get(r2.id)!.heads).toBe(2);
		expect(paidTo(AVERY.id)).toBe('28.57');
		expect(paidTo(SAM.id)).toBe('11.43');
		expect(money(w.get(r1.id)!.billed)).toBe('0.00');
		expect(w.get(r1.id)!.earned!.add(w.get(r2.id)!.earned!).toFixed(2)).toBe('250.00');
	});

	it('a capped pool is drawn in the order the work was done', () => {
		const c = coverage(all, agreements);
		expect([c3, c4, c5].map((e) => c.get(e.id)!.coveredSeconds)).toEqual([3600, 1800, 0]);
	});

	it('partly covered bills the rest at the going rate and pays it by the hour', () => {
		const w = worth(all, ctx());
		expect(money(w.get(c4.id)!.billed)).toBe('15.00');
		expect(money(w.get(c4.id)!.paid)).toBe('19.30');
		expect(money(w.get(c5.id)!.billed)).toBe('30.00');
		expect(money(w.get(c5.id)!.paid)).toBe('13.00');
	});

	it('bills to the increment and pays to the second', () => {
		// 22 min 40 s for a client with no retainer: billed as 23 minutes at
		// $60.00, and paid for the 1,360 seconds worked at $26.00 an hour.
		const walkIn = entry({
			entityId: 'e-walk-in',
			serviceId: 'retained',
			workedOn: '2026-10-05',
			seconds: 1360
		});
		const w = worth([walkIn], ctx()).get(walkIn.id)!;
		expect([w.billedSeconds, money(w.billed), money(w.paid)]).toEqual([1360, '23.00', '9.82']);
	});

	it("is worked out to the currency's places: none for yen, three for dinars", () => {
		const figures = (w: ReturnType<typeof worth>) =>
			[w.get(c5.id)!.billed, w.get(c5.id)!.paid, w.get(r1.id)!.billed].map(money);
		expect(figures(worth(all, ctx({ places: 0 })))).toEqual(['30', '13', '0']);
		expect(figures(worth(all, ctx({ places: 3 })))).toEqual(['30.000', '13.000', '0.000']);
	});

	it('past a no-charge pool bills nothing', () => {
		const free = agreements.map((a) =>
			a.id === 'a-capped'
				? { ...a, services: [{ ...a.services[0], overage: 'no_charge' as const }] }
				: a
		);
		expect(money(worth(all, ctx({ agreements: free })).get(c5.id)!.billed)).toBe('0.00');
	});

	it('unlimited and not yet charged: covered, billed nothing, pay unknown', () => {
		const w = worth(all, ctx()).get(r6.id)!;
		expect(w.coveredSeconds).toBe(45 * 60);
		expect(money(w.billed)).toBe('0.00');
		expect(w.paid).toBeNull();
	});

	it('capped and not yet charged: no pool to draw, so no value at all', () => {
		const w = worth(all, ctx()).get(c7.id)!;
		expect(w.coveredSeconds).toBeNull();
		expect(w.billed).toBeNull();
	});

	it('a share of a charge not yet made is unknown; 0% or nothing of it is $0.00', () => {
		expect(worth(all, ctx()).get(k8.id)!.paid).toBeNull();
		expect(money(worth(all, ctx({ rules: rules('percent', '0') })).get(k8.id)!.paid)).toBe('0.00');
		expect(money(worth(all, ctx({ rules: rules('nothing', null) })).get(k8.id)!.paid)).toBe('0.00');
	});

	it('a given period is known: covered hours pay and earn $0.00', () => {
		const given = agreements.map((a) =>
			a.id === 'a-retained'
				? {
						...a,
						periods: [
							...a.periods,
							{
								id: 'p-retained-nov',
								periodStart: '2026-11-01',
								periodEnd: '2026-11-30',
								amount: '0.00',
								given: true
							}
						]
					}
				: a
		);
		const w = worth(all, ctx({ agreements: given })).get(r6.id)!;
		expect(money(w.paid)).toBe('0.00');
		expect(money(w.earned)).toBe('0.00');
	});
});

describe("a site's own agreement comes before the client's", () => {
	const CLIENT = 'e-two-sites';
	const agreements: Agreement[] = [
		{
			id: 'a-client',
			entityId: CLIENT,
			siteId: null,
			startsOn: '2026-09-01',
			endsOn: null,
			services: [
				{ serviceId: 'helpdesk', allotment: 'capped', includedHours: '2.50', overage: 'bill' }
			],
			periods: []
		},
		{
			id: 'a-site-two',
			entityId: CLIENT,
			siteId: 's-two',
			startsOn: '2026-09-12',
			endsOn: null,
			services: [
				{ serviceId: 'helpdesk', allotment: 'capped', includedHours: '1.00', overage: 'bill' }
			],
			periods: []
		}
	];
	it("site one falls to the client's, site two to its own", () => {
		const one = entry({
			entityId: CLIENT,
			siteId: 's-one',
			serviceId: 'helpdesk',
			workedOn: '2026-09-15',
			seconds: 30 * 60
		});
		const two = entry({
			entityId: CLIENT,
			siteId: 's-two',
			serviceId: 'helpdesk',
			workedOn: '2026-09-15',
			seconds: 30 * 60
		});
		const c = coverage([one, two], agreements);
		expect(c.get(one.id)!.agreementId).toBe('a-client');
		expect(c.get(two.id)!.agreementId).toBe('a-site-two');
	});
	it('non-billable time is never covered', () => {
		const e = entry({
			entityId: CLIENT,
			serviceId: 'helpdesk',
			workedOn: '2026-09-15',
			seconds: 30 * 60,
			billable: false
		});
		expect(coverage([e], agreements).get(e.id)!).toMatchObject({
			agreementId: null,
			coveredSeconds: 0
		});
	});
	it('but the meter counts it against the agreement it falls under', () => {
		const e = entry({
			entityId: CLIENT,
			siteId: 's-two',
			serviceId: 'helpdesk',
			workedOn: '2026-09-15',
			seconds: 75 * 60,
			billable: false
		});
		expect(agreementFor(e, agreements)?.a.id).toBe('a-site-two');
		expect(hoursOf(e.seconds)).toBe('1.25');
	});
	it("nothing falls under an agreement that has not started, or another service's", () => {
		expect(
			agreementFor(
				entry({
					entityId: CLIENT,
					serviceId: 'helpdesk',
					workedOn: '2026-08-31',
					seconds: 30 * 60
				}),
				agreements
			)
		).toBeNull();
		expect(
			agreementFor(
				entry({ entityId: CLIENT, serviceId: 'field', workedOn: '2026-09-15', seconds: 30 * 60 }),
				agreements
			)
		).toBeNull();
	});
});

describe('tax collected is split by what CDTFA said', () => {
	const check = {
		siteId: 's-woodland',
		ratePct: '8.0000',
		statePct: '7.2500',
		districtPct: '0.7500',
		jurisdiction: 'WOODLAND'
	};
	it('100.00 at 8.00% is 7.25 state and 0.75 district', () => {
		const t = invoiceTax(
			[
				{
					invoiceId: 'i',
					amount: '100.00',
					taxable: true,
					taxRatePct: '8.0000',
					siteId: 's-woodland'
				}
			],
			[{ ...check, checkedOn: '2026-09-01', checkedAt: new Date('2026-09-01T12:00:00Z') }],
			new Map([['i', '2026-09-30']]),
			'2026-09-30',
			TAX_ROUNDING.us_ca,
			CENTS
		).get('i')!;
		expect([t.tax, t.stateTax, t.districtTax].map(money)).toEqual(['8.00', '7.25', '0.75']);
		expect(t.estimatedLines).toBe(0);
		expect(t.jurisdiction).toBe('WOODLAND');
	});
	it('an invoice from before the first answer is split by it, as an estimate', () => {
		const t = invoiceTax(
			[
				{
					invoiceId: 'i',
					amount: '100.00',
					taxable: true,
					taxRatePct: '8.0000',
					siteId: 's-woodland'
				}
			],
			[{ ...check, checkedOn: '2026-09-01', checkedAt: new Date('2026-09-01T12:00:00Z') }],
			new Map([['i', '2026-08-01']]),
			'2026-09-30',
			TAX_ROUNDING.us_ca,
			CENTS
		).get('i')!;
		expect(t.estimatedLines).toBe(1);
		expect(money(t.stateTax)).toBe('7.25');
	});
	it('a line with no answer at all is left unsplit', () => {
		const t = invoiceTax(
			[{ invoiceId: 'i', amount: '50.00', taxable: true, taxRatePct: '7.2500', siteId: null }],
			[],
			new Map([['i', null]]),
			'2026-09-30',
			TAX_ROUNDING.us_ca,
			CENTS
		).get('i')!;
		expect(money(t.tax)).toBe('3.63');
		expect(t.stateTax).toBeNull();
		expect(t.linesWithoutASplit).toBe(1);
	});
});

/**
 * Tax is rounded as its rule says (#lib/server/tax-rules): where, how and to
 * what. A cent either way is the whole difference, so each case is one.
 */
describe('tax is rounded by its rule', () => {
	const line = (amount: string, taxRatePct: string) => ({
		invoiceId: 'i',
		amount,
		taxable: true,
		taxRatePct,
		siteId: null
	});
	const taxOf = (lines: ReturnType<typeof line>[], rounding: TaxRounding) =>
		money(
			invoiceTax(lines, [], new Map([['i', null]]), '2026-09-30', rounding, CENTS).get('i')!.tax
		);

	// 0.005 at one rate and 0.015 at another: 0.02 rounded once, but 0.01 and
	// 0.02 rounded for each rate, as California and Japan round.
	it('once per invoice for each rate', () => {
		expect(taxOf([line('0.10', '5.0000'), line('0.10', '15.0000')], TAX_ROUNDING.us_ca)).toBe(
			'0.03'
		);
	});

	// Two lines of 0.004 at one rate: 0.008, a cent, rounded for the rate; but
	// nothing, rounded on each line.
	it('or on each line, where the rule says so', () => {
		const lines = [line('0.10', '4.0000'), line('0.10', '4.0000')];
		expect(taxOf(lines, { scope: 'invoice', method: 'half_up' })).toBe('0.01');
		expect(taxOf(lines, { scope: 'line', method: 'half_up' })).toBe('0.00');
	});

	it('down or up, where the rule lets the business choose', () => {
		const lines = [line('12.34', '10.0000')];
		expect(taxOf(lines, { scope: 'invoice', method: 'down' })).toBe('1.23');
		expect(taxOf(lines, { scope: 'invoice', method: 'up' })).toBe('1.24');
		expect(taxOf(lines, { scope: 'invoice', method: 'half_up' })).toBe('1.23');
	});
});

/**
 * A rate is a price for one of something, held to four places, so it can be
 * finer than the currency: 72.5¢ a mile, the IRS business rate for the first
 * half of 2026. What it bills is rounded to the currency's places, once.
 */
describe('a rate is a price, finer than the currency where it needs to be', () => {
	const travel: ServiceTerms = {
		id: 'travel',
		unit: 'mile',
		billToNearestSeconds: null,
		minimumCharge: null
	};
	const leg = (rate: string) =>
		legWorth(
			{ serviceId: 'travel', entityId: ALDER, miles: '28.00' },
			'2026-03-02',
			new Map([['travel', travel]]),
			[price('travel', rate)],
			CENTS
		);

	it("72.5¢ a mile is 72.5¢, and 28 miles of it bill $20.30, not 73¢'s $20.44", () => {
		expect(money(leg('0.7250').rate)).toBe('0.7250');
		expect(money(leg('0.7250').billed)).toBe('20.30');
	});

	it('a crew at finer rates bills what they come to, rounded once', () => {
		const rate = jobRate(price('field', '95.125', '45.0625'), 2);
		expect(money(rate)).toBe('140.1875');
		const hour = hourly('field', { billToNearestSeconds: null });
		expect(money(billedAmount(hour, rate, Ratio.of(1), CENTS))).toBe('140.19');
	});
});

describe('the rest', () => {
	it("a leg bills its miles at one person's rate on the day", () => {
		const travel: ServiceTerms = {
			id: 'travel',
			unit: 'mile',
			billToNearestSeconds: null,
			minimumCharge: null
		};
		const w = legWorth(
			{ serviceId: 'travel', entityId: ALDER, miles: '28.00' },
			'2026-09-01',
			new Map([['travel', travel]]),
			[price('travel', '0.66')],
			CENTS
		);
		expect(money(w.billed)).toBe('18.48');
	});
});

/**
 * Every amount is rounded half up to its currency's places (#lib/currency): a
 * yen has none, a Kuwaiti dinar has three. The same arithmetic as the dollar
 * cases above, to other places.
 */
describe("every amount is rounded to its currency's places", () => {
	const YEN = 0;
	const DINARS = 3;

	it('a rate with heads, which is a price and is not rounded', () => {
		expect(money(jobRate(price('field', '9500', '4500'), 2))).toBe('14000');
		expect(money(jobRate(price('field', '9500.5', '4500'), 2))).toBe('14000.5');
		expect(money(jobRate(price('field', '12.345', '4.5'), 2))).toBe('16.845');
	});

	it('23 minutes billed: ¥3,641.67 is ¥3,642, and 4.73225 dinars is 4.732', () => {
		const q = Ratio.of(1360).div(3600);
		expect(money(billedAmount(hourly('field'), Decimal.from('9500'), q, YEN))).toBe('3642');
		expect(money(billedAmount(hourly('field'), Decimal.from('12.345'), q, DINARS))).toBe('4.732');
	});

	it('pay by the hour and a share of a retainer', () => {
		const perHour = (amount: string) => rule({ serviceId: 'field', method: 'per_hour', amount });
		expect(money(timePay(perHour('2600'), 1360, null, YEN))).toBe('982');
		expect(money(timePay(perHour('4.5'), 1360, null, DINARS))).toBe('1.700');
		const pct = rule({
			serviceId: 'helpdesk',
			paysFor: 'covered_time',
			method: 'percent',
			amount: '15'
		});
		expect(money(coveredPay(pct, Ratio.of('65.125'), DINARS))).toBe('9.769');
		expect(money(coveredPay(rule({ ...pct, method: 'nothing' }), null, YEN))).toBe('0');
	});

	it("tax, as its rule rounds it, to the currency's places", () => {
		const tax = (amount: string, places: number) =>
			money(
				invoiceTax(
					[{ invoiceId: 'i', amount, taxable: true, taxRatePct: '8.0000', siteId: null }],
					[],
					new Map([['i', null]]),
					'2026-09-30',
					TAX_ROUNDING.us_ca,
					places
				).get('i')!.tax
			);
		expect(tax('1234', YEN)).toBe('99');
		expect(tax('12.345', DINARS)).toBe('0.988');
	});

	it('a leg of mileage', () => {
		const travel: ServiceTerms = {
			id: 'travel',
			unit: 'mile',
			billToNearestSeconds: null,
			minimumCharge: null
		};
		const leg = (rate: string, places: number) =>
			money(
				legWorth(
					{ serviceId: 'travel', entityId: ALDER, miles: '28.00' },
					'2026-09-01',
					new Map([['travel', travel]]),
					[price('travel', rate)],
					places
				).billed
			);
		expect(leg('105', YEN)).toBe('2940');
		expect(leg('0.125', DINARS)).toBe('3.500');
	});
});

/**
 * A lot keeps what its receipt says -- what all of it cost before tax and in
 * tax -- and a unit's share is worked out from those, weighted across what is
 * left of every lot on the shelf.
 */
describe('a material is worth what its lots cost, weighted by what is left', () => {
	const spool = (
		qtyReceived: string,
		qtyRemaining: string,
		exTaxCost: string,
		taxPaid: string
	) => ({
		qtyReceived,
		qtyRemaining,
		exTaxCost,
		taxPaid
	});

	it('1,000 ft for $310.00 and $24.80 is $0.31 and $0.0248 a foot, and sells at $0.372 at 20%', () => {
		const w = materialWorth([spool('1000', '1000', '310.00', '24.80')], '20', null);
		expect([w.exTax, w.taxPaid, w.price].map(money)).toEqual(['0.3100', '0.0248', '0.3720']);
	});

	it('$33.33 for 7 is not rounded a unit at a time', () => {
		// 33.33 / 7 is 4.76142857…; what is left of it is its share of the total.
		const w = materialWorth([spool('7', '7', '33.33', '0')], '0', null);
		expect(money(w.exTax)).toBe('4.7614');
	});

	it('two spools at different prices are one price to sell from', () => {
		// 400 ft left of 1,000 at $0.31, and 600 ft of 600 at $0.35: $0.334 a foot.
		const w = materialWorth(
			[spool('1000', '400', '310.00', '0'), spool('600', '600', '210.00', '0')],
			'0',
			null
		);
		expect(money(w.exTax)).toBe('0.3340');
	});
});
