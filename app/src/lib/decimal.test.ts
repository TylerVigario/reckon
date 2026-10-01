import { describe, expect, it } from 'vitest';
import { Decimal, Ratio, sum, sumMoney } from './decimal';

const d = (s: string) => Decimal.from(s);

describe('Decimal', () => {
	it('reads NUMERIC strings exactly and prints them back', () => {
		for (const s of ['0', '12.50', '-0.05', '7.2500', '999999999.9999', '-3'])
			expect(d(s).toString()).toBe(s);
		expect(d('+4.10').toString()).toBe('4.10');
	});

	it('refuses what is not a decimal, and fractions in a JS number', () => {
		for (const s of ['', '1,50', '1e3', '.5', 'NaN', '12.5.0']) expect(() => d(s)).toThrow();
		expect(() => Decimal.from(0.1)).toThrow();
		expect(Decimal.from(42).toString()).toBe('42');
	});

	it('adds and subtracts exactly where floats do not', () => {
		expect(d('0.1').add('0.2').toString()).toBe('0.3');
		expect(d('100.00').sub('33.33').toString()).toBe('66.67');
		expect(d('1.5').add('2.25').toString()).toBe('3.75');
	});

	it('multiplies exactly, keeping every place', () => {
		expect(d('95.00').mul('1.75').toString()).toBe('166.2500');
		expect(d('0.66').mul('28').toString()).toBe('18.48');
	});

	it('rounds half away from zero by default, and to even when asked', () => {
		expect(d('1.005').round(2).toString()).toBe('1.01');
		expect(d('-1.005').round(2).toString()).toBe('-1.01');
		expect(d('1.015').round(2, 'half_even').toString()).toBe('1.02');
		expect(d('1.025').round(2, 'half_even').toString()).toBe('1.02');
		expect(d('1.0049').round(2).toString()).toBe('1.00');
		expect(d('7').round(2).toString()).toBe('7.00');
	});

	it('compares across scales', () => {
		expect(d('1.50').eq('1.5')).toBe(true);
		expect(d('2').gt('1.999')).toBe(true);
		expect(d('-0.01').lt('0')).toBe(true);
		expect(Decimal.max(d('3.1'), d('3.10')).toString()).toBe('3.1');
	});
});

describe('Ratio', () => {
	it('divides exactly, and rounds once at the end', () => {
		// 22 min 40 s billed to the minute at $95: 23 min, $36.42.
		expect(d('95.00').mul(23).div(60).round(2).toString()).toBe('36.42');
		// A third of $240 at 16%: $12.80, with no rounding on the way.
		expect(Ratio.of('240').mul(30).div(90).mul('16').div(100).round(2).toString()).toBe('12.80');
		expect(d('10').div(3).round(4).toString()).toBe('3.3333');
		expect(d('-10').div(3).round(2).toString()).toBe('-3.33');
	});

	it('rounds to a whole number, ties away from zero', () => {
		expect(Ratio.of(1380).div(60).toBigInt()).toBe(23n);
		expect(Ratio.of(1350).div(60).toBigInt()).toBe(23n); // 22.5
		expect(Ratio.of(-1350).div(60).toBigInt()).toBe(-23n);
	});

	it('refuses to divide by zero', () => {
		expect(() => d('1').div(0)).toThrow();
	});
});

describe('sum', () => {
	it('adds a column of figures, skipping the empty ones', () => {
		expect(sum(['0.10', '0.20', null, undefined, '']).toString()).toBe('0.30');
		expect(sumMoney(Array.from({ length: 1000 }, () => '0.01'))).toBe('10.00');
		expect(sumMoney([])).toBe('0.00');
	});
});
