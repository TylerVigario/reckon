import { describe, expect, it } from 'vitest';
import { fromStock, passedOn, taxNeeds, type FromStock, type Terms } from './passed-on.ts';

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

describe('a line’s tax set by hand', () => {
	const cable: FromStock = {
		qty: '10',
		unit: 'foot',
		cost: '3.10',
		taxPaid: '0.25',
		listed: '0.45',
		markupPct: '20',
		kind: GOODS
	};
	const help = { ...cable, kind: HELP_DESK };

	it('not taxed, where its kind is: no rate, no source, and no site needed', () => {
		const l = fromStock({ ...cable, byHand: { taxed: false } }, CA);
		expect(l).toMatchObject({
			taxable: false,
			taxRatePct: '0',
			taxSource: 'none',
			byHand: true,
			refused: null
		});
		const away = fromStock({ ...cable, byHand: { taxed: false } }, { ...CA, site: null });
		expect([away.taxable, away.needsASite, taxNeeds(away)]).toEqual([false, false, null]);
	});

	it('taxed at the site’s rate, where its kind is not: from the site, as any taxed there', () => {
		const l = fromStock({ ...help, byHand: { taxed: true, ratePct: null } }, CA);
		expect(l).toMatchObject({
			soldAs: HELP_DESK,
			taxable: true,
			taxRatePct: '8.0000',
			taxSource: 'site',
			byHand: true
		});
	});

	it('taxed at another rate: an override, at that rate', () => {
		const l = fromStock({ ...cable, byHand: { taxed: true, ratePct: '4.0625' } }, CA);
		expect(l).toMatchObject({ taxable: true, taxRatePct: '4.0625', taxSource: 'override' });
	});

	it('refused where it changes nothing, so no reason is kept for its kind’s answer', () => {
		expect(taxNeeds(fromStock({ ...help, byHand: { taxed: false } }, CA))).toEqual({
			taxable: 'It is not taxed there anyway, as its kind is.'
		});
		expect(taxNeeds(fromStock({ ...cable, byHand: { taxed: true, ratePct: null } }, CA))).toEqual({
			taxable: 'It is taxed at the site’s rate anyway, as its kind is.'
		});
		expect(taxNeeds(fromStock({ ...help, byHand: { taxed: true, ratePct: '8' } }, CA))).toEqual({
			tax_rate_pct: 'That is the site’s rate: choose taxed at the site’s rate.'
		});
	});

	it('taxed only where it is owed: a site, in a state collected in, placed in an area', () => {
		const taxed = { ...help, byHand: { taxed: true as const, ratePct: '5' } };
		expect(taxNeeds(fromStock(taxed, { ...CA, site: null }))).toEqual({
			site_id: 'Where it went, so its tax rate is known.'
		});
		expect(taxNeeds(fromStock(taxed, { ...CA, site: { state: 'NV', ratePct: null } }))).toEqual({
			taxable: "The business doesn't collect in Nevada, so it charges no tax there."
		});
		expect(taxNeeds(fromStock(taxed, { ...CA, site: { state: 'CA', ratePct: null } }))).toEqual({
			site_id: 'That site is in no tax area yet, so its rate is not known.'
		});
	});

	it('is not had by a cost passed on, which is no sale', () => {
		const l = passedOn(
			{ kind: 'paid_for', cost: '35', taxPaid: '0', byHand: { taxed: true, ratePct: null } },
			CA
		);
		expect([l.taxable, l.byHand, l.soldAs]).toEqual([false, false, null]);
	});

	it('on goods bought for the job, as on goods from stock', () => {
		const l = passedOn(
			{ kind: 'bought', cost: '33.33', taxPaid: '2.67', byHand: { taxed: false } },
			CA
		);
		expect([l.taxable, l.byHand, l.soldAs]).toEqual([false, true, GOODS]);
	});
});
