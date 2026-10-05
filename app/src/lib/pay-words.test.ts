import { describe, expect, it } from 'vitest';
import { paysWhat } from './pay-words.ts';

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
});
