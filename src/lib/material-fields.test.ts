import { describe, expect, it } from 'vitest';
import { parseMaterialField, readPricing } from './material-fields.ts';

describe('a material changed', () => {
	it('keeps a name, and takes the rest as they are given', () => {
		expect(parseMaterialField('name', '').ok).toBe(false);
		expect(parseMaterialField('name', '12/2 Romex')).toEqual({ ok: true, value: '12/2 Romex' });
		expect(parseMaterialField('brand', '')).toEqual({ ok: true, value: null });
		expect(parseMaterialField('taxable', 'false')).toEqual({ ok: true, value: false });
	});

	it('refuses a field it does not keep', () => {
		expect(parseMaterialField('markup_pct', '40').ok).toBe(false);
	});
});

describe('what a material sells at', () => {
	it('is the business’s markup, with nothing else said', () => {
		const { values, errors } = readPricing({ by: 'business', markup_pct: '', price: '' });
		expect(errors).toEqual({});
		expect([values.by, values.markup_pct, values.price]).toEqual(['business', null, null]);
	});

	it('is a markup of its own, which it must say', () => {
		expect(readPricing({ by: 'markup', markup_pct: '', price: '' }).errors.markup_pct).toBe(
			'What markup.'
		);
		expect(readPricing({ by: 'markup', markup_pct: '40', price: '' }).values.markup_pct).toBe('40');
	});

	it('is a set price a unit, which it must say', () => {
		expect(readPricing({ by: 'price', markup_pct: '', price: '' }).errors.price).toBe(
			'What it sells at, a unit.'
		);
		expect(readPricing({ by: 'price', markup_pct: '', price: '4.50' }).errors).toEqual({});
	});

	it('is one of the three', () => {
		expect(readPricing({ by: 'cost', markup_pct: '', price: '' }).errors.by).toBeTruthy();
	});
});

describe('what a material sells at, as one choice', () => {
	it('is a set price in force, else its own markup, else the business’s', async () => {
		const { pricedBy } = await import('./material-fields.ts');
		expect(pricedBy({ markup_pct: '40', listed: '1.25' })).toEqual({
			by: 'price',
			markup_pct: null,
			price: '1.25'
		});
		expect(pricedBy({ markup_pct: '40', listed: null }).by).toBe('markup');
		expect(pricedBy({ markup_pct: null, listed: null }).by).toBe('business');
	});
});
