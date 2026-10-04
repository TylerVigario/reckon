import { describe, expect, it } from 'vitest';
import { currencyPlaces, forInput, isCurrency, MONEY_SCALE } from './currency.ts';
import { parseField } from './settings-fields.ts';

/**
 * A currency's places are Intl's, so what is stored and what is shown agree,
 * and a money column has room for every currency the setting accepts.
 */
describe('a currency has its own places', () => {
	it('two for dollars, none for yen, three for dinars', () => {
		expect([currencyPlaces('USD'), currencyPlaces('JPY'), currencyPlaces('KWD')]).toEqual([
			2, 0, 3
		]);
	});

	it('and a money column holds the places of every currency Intl knows', () => {
		const most = Math.max(...Intl.supportedValuesOf('currency').map((c) => currencyPlaces(c)));
		expect(most).toBeLessThanOrEqual(MONEY_SCALE);
	});
});

describe('the currency setting', () => {
	it('takes a currency Intl knows, however it is typed', () => {
		expect(parseField('currency', 'eur')).toEqual({ ok: true, value: 'EUR' });
		expect(isCurrency('KWD')).toBe(true);
	});

	// CLF has four places: a unit of account, not a currency anybody invoices
	// in, and more places than a money column holds.
	it('refuses three letters that are not one', () => {
		for (const code of ['XYZ', 'CLF', 'US', 'USDX'])
			expect(parseField('currency', code).ok, code).toBe(false);
	});
});

describe('a stored amount, to be edited', () => {
	it("is written to its currency's places", () => {
		expect(forInput('95.000', 2)).toBe('95.00');
		expect(forInput('9500.000', 0)).toBe('9500');
		expect(forInput('12.345', 3)).toBe('12.345');
	});

	it('never hides a place the currency does not have', () => {
		expect(forInput('95.125', 2)).toBe('95.125');
		expect(forInput('9500.500', 0)).toBe('9500.5');
	});

	it('is empty when there is none', () => {
		expect(forInput(null, 2)).toBe('');
		expect(forInput('', 2)).toBe('');
	});
});
