import { describe, expect, it } from 'vitest';
import { paysWhat, vehicleWords } from './pay-words.ts';

const money = (v: string | null) => (v === null ? '—' : `$${v}`);
const unitPrice = (v: string | null) => (v === null ? '—' : `$${v} each`);
const words = { money, unitPrice };

describe('paysWhat', () => {
	// A share is the share the rule says, not the nearest whole one: a rule for
	// 16.5% of the line read as 17% would overstate every payment it made.
	it('says a percentage rule to the places it was set at', () => {
		expect(paysWhat({ pays_for: 'time', method: 'percent', amount: '16.5000' }, words).v).toBe(
			'16.5%'
		);
		expect(paysWhat({ pays_for: 'covered_time', method: 'percent', amount: '16' }, words)).toEqual({
			v: '16%',
			x: 'of the retainer'
		});
	});

	it('says an hourly rate as a price, and a fixed sum as an amount', () => {
		expect(paysWhat({ pays_for: 'time', method: 'per_hour', amount: '22.125' }, words)).toEqual({
			v: '$22.125 each',
			x: 'an hour'
		});
		expect(paysWhat({ pays_for: 'time', method: 'fixed', amount: '15.00' }, words)).toEqual({
			v: '$15.00',
			x: 'an entry'
		});
	});

	it("says a vehicle's fixed sum by the leg, which is what its miles bill in", () => {
		expect(paysWhat({ pays_for: 'vehicle', method: 'fixed', amount: '5.00' }, words)).toEqual({
			v: '$5.00',
			x: 'a leg'
		});
	});
});

describe('vehicleWords', () => {
	const share = { pays_for: 'vehicle', method: 'percent', amount: '90' };
	it("says who a person's vehicle pays, and how much", () => {
		expect(vehicleWords('Avery Lind', [{ service: 'Travel', rule: share }], words)).toBe(
			'Its miles pay Avery Lind 90% of the line on Travel.'
		);
	});
	it("pays nobody for the business's own", () => {
		expect(vehicleWords(null, [{ service: 'Travel', rule: share }], words)).toMatch(/pay nobody/);
	});
	it('says when no rule reaches the owner', () => {
		expect(vehicleWords('Sam Ortega', [{ service: 'Travel', rule: null }], words)).toBe(
			'No vehicle rule on Travel reaches Sam Ortega yet.'
		);
	});
});
