import { describe, expect, it } from 'vitest';
import { paysWhat } from './pay-words.ts';

const money = (v: string | null) => (v === null ? '—' : `$${v}`);

describe('paysWhat', () => {
	// A share is the share the rule says, not the nearest whole one: a rule for
	// 16.5% of the line read as 17% would overstate every payment it made.
	it('says a percentage rule to the places it was set at', () => {
		expect(paysWhat({ pays_for: 'time', method: 'percent', amount: '16.5000' }, money).v).toBe(
			'16.5%'
		);
		expect(paysWhat({ pays_for: 'covered_time', method: 'percent', amount: '16' }, money)).toEqual({
			v: '16%',
			x: 'of the retainer'
		});
	});

	it('says money rules in money', () => {
		expect(paysWhat({ pays_for: 'time', method: 'per_hour', amount: '22.00' }, money)).toEqual({
			v: '$22.00',
			x: 'an hour'
		});
	});
});
