import { describe, expect, it } from 'vitest';
import { fromStock, passedOn, type FromStock, type Terms } from './passed-on.ts';

const CA: Terms = { purchaseMarkupPct: '0', ruleSet: 'us_ca', siteRatePct: '8.0000', places: 2 };

describe('goods bought for a job, passed on', () => {
	it('as they cost, taxed at the site, with the cost and tax paid kept', () => {
		const l = passedOn({ kind: 'bought', cost: '33.33', taxPaid: '2.67' }, CA);
		expect(l).toMatchObject({
			qty: '1',
			unit: 'each',
			unitPrice: '33.3300',
			amount: '33.33',
			taxable: true,
			taxRatePct: '8.0000',
			taxSource: 'site',
			exTaxCost: '33.33',
			taxPaid: '2.67',
			needsASite: false
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

	it('untaxed where no rule taxes them', () => {
		const l = passedOn({ kind: 'bought', cost: '10.00', taxPaid: '0' }, { ...CA, ruleSet: 'none' });
		expect([l.taxable, l.taxRatePct, l.taxSource, l.needsASite]).toEqual([
			false,
			'0',
			'none',
			false
		]);
	});

	it('needs a site, for its rate, where the rule taxes them', () => {
		expect(
			passedOn({ kind: 'bought', cost: '10.00', taxPaid: '0' }, { ...CA, siteRatePct: null })
				.needsASite
		).toBe(true);
	});
});

describe('a cost paid on the client’s behalf', () => {
	it('at cost, never marked up, and untaxed under California’s rule', () => {
		const l = passedOn(
			{ kind: 'paid_for', cost: '35.00', taxPaid: '0' },
			{ ...CA, purchaseMarkupPct: '15' }
		);
		expect([l.amount, l.taxable, l.taxSource, l.needsASite]).toEqual([
			'35.00',
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
		taxable: true
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

	it('untaxed when it is not goods the business taxes, and needing no site', () => {
		const l = fromStock({ ...cable, taxable: false }, { ...CA, siteRatePct: null });
		expect([l.taxable, l.needsASite]).toEqual([false, false]);
	});

	it('needs a site, for its rate, where it is taxed', () => {
		expect(fromStock(cable, { ...CA, siteRatePct: null }).needsASite).toBe(true);
	});
});

describe('the tax rules it knows', () => {
	it('are every tax rule the schema has, and no other', async () => {
		const { TAX_RULE_SETS } = await import('./server/db/schema/operator.ts');
		const { TAXES } = await import('./passed-on.ts');
		expect(Object.keys(TAXES).sort()).toEqual([...TAX_RULE_SETS].sort());
	});
});
