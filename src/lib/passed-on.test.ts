import { describe, expect, it } from 'vitest';
import { fromStock, passedOn, type FromStock, type Terms } from './passed-on.ts';

// reckon's goods, and a kind of the business's own: California taxes goods alone.
const GOODS = '019a0000-0000-7000-8000-00000000000a';
const HELP_DESK = '019a0000-0000-7000-8000-00000000000b';

const CA: Terms = {
	purchaseMarkupPct: '0',
	taxes: { CA: [GOODS] },
	goods: GOODS,
	site: { state: 'CA', ratePct: '8.0000' },
	places: 2
};

describe('goods bought for a job, passed on', () => {
	it('as they cost, taxed at the site, with the cost and tax paid kept', () => {
		const l = passedOn({ kind: 'bought', cost: '33.33', taxPaid: '2.67' }, CA);
		expect(l).toMatchObject({
			qty: '1',
			unit: 'each',
			unitPrice: '33.3300',
			amount: '33.33',
			soldAs: GOODS,
			taxable: true,
			taxRatePct: '8.0000',
			taxSource: 'site',
			exTaxCost: '33.33',
			taxPaid: '2.67',
			needsASite: false,
			needsPlacing: false
		});
	});

	it("marked up by the operator's markup on job purchases", () => {
		const l = passedOn(
			{ kind: 'bought', cost: '33.33', taxPaid: '2.67' },
			{ ...CA, purchaseMarkupPct: '15' }
		);
		// 33.33 × 1.15 = 38.3295
		expect([l.unitPrice, l.amount]).toEqual(['38.3295', '38.33']);
	});

	it('untaxed, needing no site, where the business collects nowhere', () => {
		const l = passedOn(
			{ kind: 'bought', cost: '10.00', taxPaid: '0' },
			{ ...CA, taxes: {}, site: null }
		);
		expect([l.taxable, l.taxRatePct, l.taxSource, l.needsASite, l.needsPlacing]).toEqual([
			false,
			'0',
			'none',
			false,
			false
		]);
	});

	it("untaxed at a site in a state the business doesn't collect in", () => {
		const l = passedOn(
			{ kind: 'bought', cost: '10.00', taxPaid: '0' },
			{ ...CA, site: { state: 'NV', ratePct: null } }
		);
		expect([l.taxable, l.taxSource, l.needsASite, l.needsPlacing]).toEqual([
			false,
			'none',
			false,
			false
		]);
	});

	it('needs a site, for its rate, where the business collects', () => {
		expect(
			passedOn({ kind: 'bought', cost: '10.00', taxPaid: '0' }, { ...CA, site: null }).needsASite
		).toBe(true);
	});

	it('needs the site placed in an area, where the business collects in its state', () => {
		const l = passedOn(
			{ kind: 'bought', cost: '10.00', taxPaid: '0' },
			{ ...CA, site: { state: 'CA', ratePct: null } }
		);
		expect([l.taxable, l.needsASite, l.needsPlacing]).toEqual([false, false, true]);
	});
});

describe('a cost paid on the client’s behalf', () => {
	it('at cost, never marked up, and no sale, so taxed nowhere', () => {
		const l = passedOn(
			{ kind: 'paid_for', cost: '35.00', taxPaid: '0' },
			{ ...CA, purchaseMarkupPct: '15', taxes: { CA: [GOODS, HELP_DESK] } }
		);
		expect([l.amount, l.soldAs, l.taxable, l.taxSource, l.needsASite]).toEqual([
			'35.00',
			null,
			false,
			'none',
			false
		]);
	});
});

describe('goods drawn from stock', () => {
	const cable: FromStock = {
		qty: '147',
		unit: 'foot',
		cost: '45.57',
		taxPaid: '3.6456',
		listed: null,
		markupPct: '20',
		kind: GOODS
	};

	it('at what a unit cost, marked up, and taxed at the site', () => {
		// 45.57 / 147 = 0.31 a foot; at 20%, 0.372; 147 × 0.372 = 54.684.
		const l = fromStock(cable, CA);
		expect(l).toMatchObject({
			qty: '147',
			unit: 'foot',
			unitPrice: '0.3720',
			amount: '54.68',
			taxable: true,
			taxRatePct: '8.0000',
			exTaxCost: '45.57',
			taxPaid: '3.6456',
			needsASite: false
		});
	});

	it('at the price listed for it, where there is one', () => {
		const l = fromStock({ ...cable, listed: '0.45' }, CA);
		expect([l.unitPrice, l.amount]).toEqual(['0.4500', '66.15']);
	});

	it('untaxed, needing no site, when no state collected in taxes its kind', () => {
		const l = fromStock({ ...cable, kind: HELP_DESK }, { ...CA, site: null });
		expect([l.soldAs, l.taxable, l.needsASite]).toEqual([HELP_DESK, false, false]);
	});

	it('taxed by its own state’s answer, not another’s', () => {
		const taxes = { CA: [GOODS], NV: [GOODS, HELP_DESK] };
		const at = (state: string) =>
			fromStock(
				{ ...cable, kind: HELP_DESK },
				{ ...CA, taxes, site: { state, ratePct: '8.2650' } }
			);
		expect([at('CA').taxable, at('NV').taxable, at('NV').taxRatePct]).toEqual([
			false,
			true,
			'8.2650'
		]);
	});

	it('needs a site where any state collected in taxes its kind', () => {
		const taxes = { CA: [GOODS], NV: [GOODS, HELP_DESK] };
		expect(fromStock({ ...cable, kind: HELP_DESK }, { ...CA, taxes, site: null }).needsASite).toBe(
			true
		);
	});

	it('needs a site, for its rate, where it is taxed', () => {
		expect(fromStock(cable, { ...CA, site: null }).needsASite).toBe(true);
	});
});
